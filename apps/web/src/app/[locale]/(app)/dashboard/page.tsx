// apps/web/src/app/[locale]/dashboard/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";
import Link from "next/link";
import { Zap, FileText, BarChart3, Clock, ArrowRight, Edit3 } from "lucide-react";

export const metadata = {
    title: "Overview | ContentForge AI",
};

// Yardımcı Fonksiyon: HTML içerisinden gerçek kelime sayısını hesaplar
const getWordCount = (html: string | null) => {
    if (!html) return 0;
    const text = html.replace(/<[^>]*>?/gm, ' ');
    return text.split(/\s+/).filter(word => word.length > 0).length;
};

// Yardımcı Fonksiyon: Doküman başlığını güvenli şekilde çeker
const getDocumentTitle = (doc: any) => {
    if (doc.inputPayload?.title) return doc.inputPayload.title;
    if (doc.inputPayload?.query) return doc.inputPayload.query;
    const match = doc.outputContent?.match(/<h[1-2][^>]*>(.*?)<\/h[1-2]>/);
    if (match && match[1]) return match[1].replace(/<[^>]+>/g, '').trim();
    return "Generated SEO Document";
};

export default async function DashboardPage({
    params
}: {
    params: Promise<{ locale: string }>
}) {
    const session = await getServerSession(authOptions);
    const resolvedParams = await params;
    const locale = resolvedParams.locale;

    const userId = session?.user?.id as string;

    // 1. Kullanıcının cüzdan (kredi) bilgisini çekiyoruz
    const wallet = await prisma.wallet.findUnique({
        where: { userId },
    });

    // 2. İstatistikler için kullanıcının TÜM dokümanlarını çekiyoruz
    const allDocs = await prisma.contentJob.findMany({
        where: { userId },
        select: { id: true, outputContent: true },
    });

    const totalDocuments = allDocs.length;
    const totalWords = allDocs.reduce((acc, doc) => acc + getWordCount(doc.outputContent), 0);

    // 3. Tablo için sadece EN SON 5 dokümanı detaylı çekiyoruz
    const recentDocuments = await prisma.contentJob.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
    });

    const firstName = session?.user?.name?.split(" ")[0] || "there";

    return (
        <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white transition-colors">
                        Welcome back, {firstName} 👋
                    </h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 transition-colors">
                        Here is an overview of your content generation activities.
                    </p>
                </div>
                <Link
                    href={`/${locale}/generator`}
                    className="inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-bold rounded-xl shadow-md text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all hover:scale-105"
                >
                    + Create New Content
                </Link>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">

                {/* 1. Credits Card */}
                <div className="bg-white dark:bg-gray-900 overflow-hidden shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 transition-colors hover:shadow-md flex flex-col justify-between">
                    <div className="p-5">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-amber-100 dark:bg-amber-500/20 rounded-lg">
                                <Zap className="w-6 h-6 text-amber-500" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate transition-colors">Available Credits</p>
                                <p className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white transition-colors">
                                    {wallet?.creditsAvailable?.toLocaleString() || 0}
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 px-5 py-3 border-t border-gray-200 dark:border-gray-800 transition-colors">
                        <div className="text-sm">
                            <span className="font-medium text-gray-400 dark:text-gray-500 transition-colors cursor-not-allowed">
                                View billing history
                            </span>
                        </div>
                    </div>
                </div>

                {/* 2. Documents Card */}
                <div className="bg-white dark:bg-gray-900 overflow-hidden shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 transition-colors hover:shadow-md flex flex-col justify-between">
                    <div className="p-5">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-green-100 dark:bg-green-500/20 rounded-lg">
                                <FileText className="w-6 h-6 text-green-500" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate transition-colors">Total Documents</p>
                                <p className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white transition-colors">
                                    {totalDocuments.toLocaleString()}
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 px-5 py-3 border-t border-gray-200 dark:border-gray-800 transition-colors">
                        <div className="text-sm">
                            <Link href={`/${locale}/history`} className="font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 transition-colors">
                                View all documents
                            </Link>
                        </div>
                    </div>
                </div>

                {/* 3. Words Generated Card */}
                <div className="bg-white dark:bg-gray-900 overflow-hidden shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 transition-colors hover:shadow-md flex flex-col justify-between">
                    <div className="p-5">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-blue-100 dark:bg-blue-500/20 rounded-lg">
                                <BarChart3 className="w-6 h-6 text-blue-500" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate transition-colors">Words Generated</p>
                                <p className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white transition-colors">
                                    {totalWords.toLocaleString()}
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 px-5 py-3 border-t border-gray-200 dark:border-gray-800 transition-colors">
                        <div className="text-sm flex items-center justify-between">
                            <span className="font-medium text-gray-500 dark:text-gray-400 transition-colors">Lifetime Total</span>
                            <span className="text-green-500 text-xs font-bold flex items-center"><Zap size={12} className="mr-1" /> Active</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Recent Documents Table Section */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden transition-colors">
                <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/30">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Clock className="w-5 h-5 text-blue-600" />
                        Recent Documents
                    </h2>
                    <Link href={`/${locale}/history`} className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center">
                        View All <ArrowRight className="w-4 h-4 ml-1" />
                    </Link>
                </div>

                <div className="overflow-x-auto">
                    {recentDocuments.length === 0 ? (
                        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                            You haven't generated any documents yet.
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
                                {recentDocuments.map((doc) => (
                                    <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                                        <td className="p-4">
                                            <span className="font-bold text-gray-900 dark:text-white truncate block max-w-xs sm:max-w-md">
                                                {getDocumentTitle(doc)}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${doc.status === 'COMPLETED'
                                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                : doc.status === 'FAILED'
                                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                                }`}>
                                                {doc.status}
                                            </span>
                                        </td>
                                        <td className="p-4 text-sm font-medium text-gray-600 dark:text-gray-300">
                                            {getWordCount(doc.outputContent).toLocaleString()} words
                                        </td>
                                        <td className="p-4 text-sm text-gray-500 dark:text-gray-400">
                                            {new Date(doc.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </td>
                                        <td className="p-4 text-right">
                                            <Link
                                                href={`/${locale}/editor/${doc.id}`}
                                                className="inline-flex items-center text-blue-600 dark:text-blue-400 font-bold text-sm opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                                            >
                                                Open Editor <Edit3 className="w-3.5 h-3.5 ml-1.5" />
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

        </div>
    );
}