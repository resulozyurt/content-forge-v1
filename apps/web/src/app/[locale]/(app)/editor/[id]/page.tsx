// apps/web/src/app/[locale]/(app)/editor/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";
import ProseEditor from "@/components/generator/ProseEditor";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default async function EditorPage({
    params,
}: {
    params: Promise<{ locale: string; id: string }>;
}) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) redirect("/auth/login");

    const { locale, id } = await params;

    // Enforce cross-tenant isolation — users can only open their own documents
    const document = await prisma.contentJob.findUnique({
        where: { id, userId: (session.user as any).id },
    });

    if (!document) notFound();

    // Deserialize input payload
    let outlineData: any = document.inputPayload;
    if (typeof outlineData === "string") {
        try { outlineData = JSON.parse(outlineData); } catch { /* ignore */ }
    }
    if (!outlineData || typeof outlineData !== "object") {
        outlineData = { headings: [], selectedKeywords: [] };
    }

    // Deserialize seoMetadata saved alongside the document
    // Injecting it into outlineData lets ProseEditor restore the Technical tab
    // without needing a separate prop or API call.
    let seoMetadata: any = document.seoMetadata;
    if (typeof seoMetadata === "string") {
        try { seoMetadata = JSON.parse(seoMetadata); } catch { /* ignore */ }
    }
    if (seoMetadata && typeof seoMetadata === "object") {
        outlineData.seoMetadata = seoMetadata;
    }

    // Best-effort title from multiple possible locations
    const displayTitle =
        outlineData.title ||
        seoMetadata?.metaTitle ||
        outlineData.headings?.[0]?.text ||
        "Restored Document";

    return (
        <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500 pb-12">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Link
                        href={`/${locale}/history`}
                        className="p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors shadow-sm hover:shadow-md"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{displayTitle}</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Retrieved from historical vault:{" "}
                            {new Date(document.createdAt).toLocaleString()}
                        </p>
                    </div>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
                <ProseEditor
                    outlineData={outlineData}
                    initialHtml={document.outputContent || undefined}
                    documentId={document.id}
                />
            </div>
        </div>
    );
}