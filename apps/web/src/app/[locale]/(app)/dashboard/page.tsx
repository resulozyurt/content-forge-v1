// apps/web/src/app/[locale]/(app)/dashboard/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";
import Link from "next/link";
import { Zap, FileText, BarChart3, Clock, ArrowRight, Edit3 } from "lucide-react";
import type { Prisma } from "@contentforge/database";

export const metadata = { title: "Overview | ContentForge AI" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getWordCount(html: string | null): number {
    if (!html) return 0;
    return html
        .replace(/<[^>]*>?/gm, " ")
        .split(/\s+/)
        .filter((w) => w.length > 0).length;
}

// Prisma returns Json fields as Prisma.JsonValue — cast via unknown to access
// properties safely without triggering TypeScript's strict index-signature checks.
function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, any> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, any>;
    }
    return {};
}

function getDocumentTitle(doc: {
    inputPayload: Prisma.JsonValue;
    seoMetadata: Prisma.JsonValue | null;
    outputContent: string | null;
}): string | null {
    const payload = asRecord(doc.inputPayload);
    const seo = asRecord(doc.seoMetadata);
    const nestedSeo = asRecord(payload.seoMetadata);

    // Priority order: saved title → seoMetadata.metaTitle → nested → query → H1/H2 regex
    if (payload.title && payload.title !== "Generated SEO Article") return String(payload.title);
    if (seo.metaTitle) return String(seo.metaTitle);
    if (nestedSeo.metaTitle) return String(nestedSeo.metaTitle);
    if (payload.query) return String(payload.query);

    const match = doc.outputContent?.match(/<h[12][^>]*>(.*?)<\/h[12]>/i);
    if (match?.[1]) return match[1].replace(/<[^>]+>/g, "").trim();

    return null; // null = untitled / duplicate — will be filtered out
}

// ---------------------------------------------------------------------------
// Page (server component)
// ---------------------------------------------------------------------------
export default async function DashboardPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const session = await getServerSession(authOptions);
    const { locale } = await params;
    const userId = (session?.user as any)?.id as string;

    // Wallet credits
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    // Aggregate word count across all docs (lightweight select)
    const allDocs = await prisma.contentJob.findMany({
        where: { userId },
        select: { outputContent: true },
    });
    const totalWords = allDocs.reduce((acc, d) => acc + getWordCount(d.outputContent), 0);

    // Over-fetch completed docs so we can deduplicate and still show 5 unique entries
    const rawRecent = await prisma.contentJob.findMany({
        where: { userId, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
            id: true,
            status: true,
            outputContent: true,
            createdAt: true,
            seoMetadata: true,     // Prisma.JsonValue | null
            inputPayload: true,    // Prisma.JsonValue
        },
    });

    // Deduplicate by content fingerprint; skip untitled entries
    const seenContent = new Set<string>();
    const uniqueRecent: typeof rawRecent = [];

    for (const doc of rawRecent) {
        const title = getDocumentTitle(doc);
        if (!title) continue; // skip untitled / failed title extraction
        const key = (doc.outputContent || "").slice(0, 200);
        if (!seenContent.has(key)) {
            seenContent.add(key);
            uniqueRecent.push(doc);
        }
        if (uniqueRecent.length >= 5) break;
    }

    // Total count for the stat card (completed docs only)
    const totalDocuments = await prisma.contentJob.count({
        where: { userId, status: "COMPLETED" },
    });

    const firstName = session?.user?.name?.split(" ")[0] || "there";

    return (
        <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Page header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Welcome back, {firstName} 👋
                    </h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Here is an overview of your content generation activities.
                    </p>
                </div>
                <Link
                    href={`/${locale}/generator`}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl shadow-md hover:from-blue-700 hover:to-indigo-700 hover:scale-[1.02] transition-all text-sm"
                >
                    <Zap size={16} /> + Create New Content
                </Link>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {/* Credits */}
                <div className="bg-white dark:bg-gray-900 shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 flex flex-col justify-between hover:shadow-md transition-shadow">
                    <div className="p-5 flex items-center gap-4">
                        <div className="p-3 bg-yellow-100 dark:bg-yellow-500/20 rounded-lg">
                            <Zap className="w-6 h-6 text-yellow-500" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Available Credits</p>
                            <p className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white">
                                {wallet?.creditsAvailable ?? 0}
                            </p>
                        </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 px-5 py-3 border-t border-gray-200 dark:border-gray-800">
                        <Link
                            href={`/${locale}/settings`}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
                        >
                            View billing history
                        </Link>
                    </div>
                </div>

                {/* Total documents */}
                <div className="bg-white dark:bg-gray-900 shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 flex flex-col justify-between hover:shadow-md transition-shadow">
                    <div className="p-5 flex items-center gap-4">
                        <div className="p-3 bg-green-100 dark:bg-green-500/20 rounded-lg">
                            <FileText className="w-6 h-6 text-green-500" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Documents</p>
                            <p className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white">
                                {totalDocuments}
                            </p>
                        </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 px-5 py-3 border-t border-gray-200 dark:border-gray-800">
                        <Link
                            href={`/${locale}/history`}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
                        >
                            View all documents
                        </Link>
                    </div>
                </div>

                {/* Words generated */}
                <div className="bg-white dark:bg-gray-900 shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 flex flex-col justify-between hover:shadow-md transition-shadow">
                    <div className="p-5 flex items-center gap-4">
                        <div className="p-3 bg-blue-100 dark:bg-blue-500/20 rounded-lg">
                            <BarChart3 className="w-6 h-6 text-blue-500" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Words Generated</p>
                            <p className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white">
                                {totalWords.toLocaleString()}
                            </p>
                        </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 px-5 py-3 border-t border-gray-200 dark:border-gray-800">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-gray-500 dark:text-gray-400">Lifetime Total</span>
                            <span className="text-green-500 text-xs font-bold flex items-center gap-1">
                                <Zap size={12} /> Active
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Recent documents table */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/30">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Clock className="w-5 h-5 text-blue-600" /> Recent Documents
                    </h2>
                    <Link
                        href={`/${locale}/history`}
                        className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                        View All <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>

                <div className="overflow-x-auto">
                    {uniqueRecent.length === 0 ? (
                        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                            You haven&apos;t generated any documents yet.{" "}
                            <Link href={`/${locale}/generator`} className="text-blue-600 hover:underline font-medium">
                                Create your first one →
                            </Link>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                                    <th className="p-4 font-semibold">Document Title</th>
                                    <th className="p-4 font-semibold">Status</th>
                                    <th className="p-4 font-semibold">Word Count</th>
                                    <th className="p-4 font-semibold">Date Created</th>
                                    <th className="p-4 font-semibold text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {uniqueRecent.map((doc) => {
                                    // Re-call inside the render loop so TypeScript sees the narrowed type
                                    const title = getDocumentTitle(doc) ?? "Generated SEO Document";
                                    return (
                                        <tr
                                            key={doc.id}
                                            className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group"
                                        >
                                            <td className="p-4">
                                                <span className="font-bold text-gray-900 dark:text-white truncate block max-w-xs sm:max-w-md">
                                                    {title}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <span
                                                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${doc.status === "COMPLETED"
                                                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                            : doc.status === "FAILED"
                                                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                                : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                                        }`}
                                                >
                                                    {doc.status}
                                                </span>
                                            </td>
                                            <td className="p-4 text-sm text-gray-600 dark:text-gray-300 font-medium">
                                                {getWordCount(doc.outputContent).toLocaleString()} words
                                            </td>
                                            <td className="p-4 text-sm text-gray-500 dark:text-gray-400">
                                                {new Date(doc.createdAt).toLocaleDateString(undefined, {
                                                    year: "numeric",
                                                    month: "short",
                                                    day: "numeric",
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                })}
                                            </td>
                                            <td className="p-4 text-right">
                                                <Link
                                                    href={`/${locale}/editor/${doc.id}`}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors opacity-0 group-hover:opacity-100"
                                                >
                                                    <Edit3 size={12} /> Open
                                                </Link>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}