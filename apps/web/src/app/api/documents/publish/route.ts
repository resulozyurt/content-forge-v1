// apps/web/src/app/api/documents/publish/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { headers } from "next/headers";

export async function POST(req: Request) {
    try {
        // 1. Authentication & Session Validation
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "Unauthorized access. Authentication is required to publish documents." }, 
                { status: 401 }
            );
        }

        const userId = (session.user as any).id;

        // 2. Rate Limiting: Prevent spamming the WordPress target (Max 10 publishes per hour)
        const ip = (await headers()).get('x-forwarded-for') || '127.0.0.1';
        const limiter = await rateLimit(`wp_publish_${userId}_${ip}`, 10, 60 * 60 * 1000);

        if (!limiter.success) {
            return NextResponse.json(
                { error: "Publishing quota exceeded. Please wait before pushing new articles to WordPress." }, 
                { 
                    status: 429, 
                    headers: getRateLimitHeaders(limiter.limit, limiter.remaining, limiter.reset) 
                }
            );
        }

        // 3. Extract Document Payload
        const { title, content } = await req.json();

        if (!title || !content) {
            return NextResponse.json(
                { error: "Invalid payload: Document title and HTML content are required." }, 
                { status: 400 }
            );
        }

        // 4. Retrieve User's WordPress Integration Settings
        const userSettings = await prisma.userSettings.findUnique({
            where: { userId: userId }
        });

        if (!userSettings || !userSettings.wpUrl || !userSettings.wpUsername || !userSettings.wpAppPassword) {
            return NextResponse.json(
                { error: "WordPress integration is incomplete. Please configure your WP URL and Application Password in settings." }, 
                { status: 403 }
            );
        }

        console.log(`[WP_INTEGRATION] Initiating content transmission to target environment: ${userSettings.wpUrl}`);

        // 5. Sanitize and Format Target URL
        let targetUrl = userSettings.wpUrl.trim();
        // Strip trailing slash if present to ensure clean REST API path concatenation
        if (targetUrl.endsWith('/')) {
            targetUrl = targetUrl.slice(0, -1);
        }
        
        const wpApiEndpoint = `${targetUrl}/wp-json/wp/v2/posts`;

        // 6. Construct Basic Auth Token using Application Passwords
        const authString = `${userSettings.wpUsername.trim()}:${userSettings.wpAppPassword.trim()}`;
        const encodedAuth = Buffer.from(authString).toString('base64');

        // 7. Dispatch Payload to WordPress REST API
        const wpResponse = await fetch(wpApiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${encodedAuth}`,
                'User-Agent': 'ContentForge-Integration-Agent/1.0'
            },
            body: JSON.stringify({
                title: title,
                content: content,
                status: userSettings.defaultStatus || 'draft', // Safely default to 'draft' to prevent accidental live publishing
                ping_status: 'closed',
                comment_status: 'closed'
            })
        });

        const wpData = await wpResponse.json();

        // 8. Handle Target System Rejections
        if (!wpResponse.ok) {
            console.error(`[WP_TRANSMISSION_FAULT] Target rejected payload. Status: ${wpResponse.status}`, wpData);
            throw new Error(wpData.message || "Failed to transmit document to the target WordPress environment.");
        }

        console.log(`[SUCCESS] Document successfully persisted to WordPress. WP Post ID: ${wpData.id}`);

        // 9. Return Success Confirmation to UI
        return NextResponse.json({ 
            message: "Successfully published to WordPress.",
            postId: wpData.id,
            postUrl: wpData.link
        }, { status: 200 });

    } catch (error: any) {
        console.error("[WP_INTEGRATION_CRITICAL_FAULT]:", error);
        return NextResponse.json(
            { error: error.message || "A critical fault occurred during the WordPress transmission sequence." }, 
            { status: 500 }
        );
    }
}