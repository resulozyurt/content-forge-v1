// apps/web/src/app/api/documents/publish/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@contentforge/database";
import { decrypt } from "@/lib/encryption";
import { BillingGuard } from "@/lib/billing";

// Set a moderate timeout for external REST API calls
export const maxDuration = 30;

export async function POST(req: Request) {
    try {
        // 1. Authentication & Session Validation
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized access. Please log in." }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const PUBLISH_COST = 1; // Publishing consumes 1 credit

        // 2. Billing Guard Validation
        await BillingGuard.checkCredits(userId, PUBLISH_COST);

        const { title, content } = await req.json();

        if (!title || !content) {
            return NextResponse.json({ error: "Missing required payload parameters (title or content)." }, { status: 400 });
        }

        // 3. Retrieve user-specific WordPress configuration
        const userSettings = await db.userSettings.findUnique({
            where: { userId }
        });

        if (!userSettings?.wpUrl || !userSettings?.wpUsername || !userSettings?.wpAppPassword) {
            return NextResponse.json({ 
                error: "WordPress credentials are not configured. Please update your settings." 
            }, { status: 403 });
        }

        // 4. Decrypt the application password securely
        let plainPassword = "";
        try {
            plainPassword = decrypt(userSettings.wpAppPassword);
        } catch (decryptionError) {
            console.error("[DECRYPTION_FAULT]: Failed to decrypt WordPress application password.", decryptionError);
            return NextResponse.json({ error: "Failed to authenticate with WordPress due to corrupted credentials." }, { status: 500 });
        }

        // 5. Construct the WordPress REST API endpoint and authentication headers
        // Ensure the URL does not have a trailing slash before appending the endpoint
        const cleanWpUrl = userSettings.wpUrl.replace(/\/$/, "");
        const wpEndpoint = `${cleanWpUrl}/wp-json/wp/v2/posts`;
        
        const credentials = btoa(`${userSettings.wpUsername}:${plainPassword}`);
        const authHeader = `Basic ${credentials}`;

        console.log(`[WP_PUBLISH_PIPELINE] Initiating transmission to: ${cleanWpUrl}`);

        // 6. Transmit the payload to WordPress
        const wpResponse = await fetch(wpEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": authHeader,
                "User-Agent": "ContentForge-Agent/1.0"
            },
            body: JSON.stringify({
                title: title,
                content: content,
                status: userSettings.defaultStatus || "draft", // Push as draft by default for safety
            })
        });

        if (!wpResponse.ok) {
            const wpError = await wpResponse.json().catch(() => ({}));
            console.error("[WP_REST_ERROR]:", wpError);
            throw new Error(wpError.message || "The destination WordPress server rejected the payload.");
        }

        const wpData = await wpResponse.json();

        // 7. Finalize the transaction and deduct tokens
        await BillingGuard.deductCredits(userId, PUBLISH_COST);
        console.log(`[SUCCESS] Article transmitted to WordPress successfully. Post ID: ${wpData.id}`);

        return NextResponse.json({ 
            success: true, 
            postId: wpData.id, 
            postUrl: wpData.link 
        }, { status: 200 });

    } catch (error: any) {
        console.error("[PUBLISH_PIPELINE_ERROR]:", error);
        return NextResponse.json({ 
            error: error.message || "An unexpected fault occurred during the publishing pipeline." 
        }, { status: 500 });
    }
}