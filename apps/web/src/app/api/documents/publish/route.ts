// apps/web/src/app/api/documents/publish/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { decrypt } from "@/lib/encryption";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized. Authentication required to publish." },
        { status: 401 }
      );
    }

    const userId = (session.user as any).id;

    // Rate limit: 10 publishes/hour
    const ip = (await headers()).get("x-forwarded-for") || "127.0.0.1";
    const limiter = await rateLimit(`wp_publish_${userId}_${ip}`, 10, 60 * 60 * 1000);
    if (!limiter.success) {
      return NextResponse.json(
        { error: "Publishing quota exceeded. Please wait before pushing new articles." },
        { status: 429, headers: getRateLimitHeaders(limiter.limit, limiter.remaining, limiter.reset) }
      );
    }

    const { title, content, seoMetadata } = await req.json();

    if (!title || !content) {
      return NextResponse.json(
        { error: "Document title and HTML content are required." },
        { status: 400 }
      );
    }

    // Retrieve WP settings
    const userSettings = await prisma.userSettings.findUnique({ where: { userId } });
    if (!userSettings?.wpUrl || !userSettings?.wpUsername || !userSettings?.wpAppPassword) {
      return NextResponse.json(
        { error: "WordPress integration incomplete. Configure WP URL and App Password in settings." },
        { status: 403 }
      );
    }

    let targetUrl = userSettings.wpUrl.trim().replace(/\/$/, "");

    // Decrypt password
    let plainPassword: string;
    try {
      plainPassword = decrypt(userSettings.wpAppPassword);
    } catch {
      return NextResponse.json(
        { error: "Failed to authenticate with WordPress — cryptographic key mismatch." },
        { status: 500 }
      );
    }

    const encodedAuth = Buffer.from(
      `${userSettings.wpUsername.trim()}:${plainPassword.trim()}`
    ).toString("base64");

    // ── Build post payload with Rank Math meta ──────────────────────────
    // Rank Math stores meta via its own REST endpoint OR via post meta fields.
    // Strategy: create the post first, then PATCH meta via /wp/v2/posts/{id}
    // using the `meta` field which Rank Math registers automatically when active.
    const meta = seoMetadata || {};

    const postPayload: Record<string, any> = {
      title,
      content,
      status: userSettings.defaultStatus || "draft",
      ping_status: "closed",
      comment_status: "closed",
      // Rank Math meta fields (registered by Rank Math plugin in REST API)
      meta: {
        rank_math_focus_keyword: meta.focusKeyword || "",
        rank_math_title: meta.metaTitle || title,
        rank_math_description: meta.metaDescription || "",
        rank_math_robots: ["index", "follow"],
        // Yoast fallback (in case Rank Math is not active)
        _yoast_wpseo_focuskw: meta.focusKeyword || "",
        _yoast_wpseo_title: meta.metaTitle || title,
        _yoast_wpseo_metadesc: meta.metaDescription || "",
      },
    };

    const wpApiEndpoint = `${targetUrl}/wp-json/wp/v2/posts`;

    console.log(`[WP_PUBLISH] Dispatching to ${wpApiEndpoint}`);

    const wpResponse = await fetch(wpApiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${encodedAuth}`,
        "User-Agent": "ContentForge-Integration-Agent/2.0",
      },
      body: JSON.stringify(postPayload),
    });

    const wpData = await wpResponse.json();

    if (!wpResponse.ok) {
      console.error(`[WP_PUBLISH_FAULT] Status ${wpResponse.status}`, wpData);
      throw new Error(wpData.message || "WordPress rejected the payload.");
    }

    const postId: number = wpData.id;
    console.log(`[WP_PUBLISH] Post created. ID: ${postId}`);

    // ── PATCH Rank Math focus keyword via dedicated endpoint (if available) ─
    // Rank Math exposes /rankmath/v1/updateMeta — try it as a best-effort
    try {
      const rmEndpoint = `${targetUrl}/wp-json/rankmath/v1/updateMeta`;
      await fetch(rmEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${encodedAuth}`,
        },
        body: JSON.stringify({
          objectID: postId,
          objectType: "post",
          meta: {
            focusKeyword: meta.focusKeyword || "",
            title: meta.metaTitle || title,
            description: meta.metaDescription || "",
          },
        }),
      });
      console.log(`[RANK_MATH] Meta patched for post ${postId}`);
    } catch {
      // Non-critical — meta was already set via post meta field above
    }

    return NextResponse.json(
      { message: "Successfully published to WordPress.", postId, postUrl: wpData.link },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[WP_PUBLISH_CRITICAL]:", error);
    return NextResponse.json(
      { error: error.message || "Critical fault during WordPress transmission." },
      { status: 500 }
    );
  }
}