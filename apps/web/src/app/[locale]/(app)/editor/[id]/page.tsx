// apps/web/src/app/[locale]/dashboard/editor/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";
import ProseEditor from "@/components/generator/ProseEditor";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default async function EditorPage({
    params
}: {
    params: Promise<{ locale: string; id: string }>
}) {
    // 1. Authenticate Request
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        redirect("/auth/login");
    }

    const resolvedParams = await params;
    const { locale, id } = resolvedParams;

    // 2. Fetch the historical document safely from the cluster
    const document = await prisma.contentJob.findUnique({
        where: {
            id: id,
            userId: (session.user as any).id // Security: Ensure cross-tenant isolation
        }
    });

    if (!document) {
        notFound();
    }

    // 3. Deserialize the original architectural payload
    let outlineData = document.inputData as any;
    if (typeof outlineData === 'string') {
        try { outlineData = JSON.parse(outlineData); } catch (e) { }
    }

    // Default object protection
    if (!outlineData) outlineData = { headings: [], selectedKeywords: [] };

    return (
        <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500 pb-12">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Link
                        href={`/${locale}/dashboard/history`}
                        className="p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors shadow-sm hover:shadow-md"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                            {outlineData.title || "Restored Document"}
                        </h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Retrieved from historical vault: {new Date(document.createdAt).toLocaleString()}
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