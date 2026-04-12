// apps/web/src/app/[locale]/dashboard/history/page.tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Search, Filter, FileText, Calendar, Edit3, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function HistoryPage() {
    const [documents, setDocuments] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("All");

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const res = await fetch('/api/documents/history');
                if (res.ok) {
                    const data = await res.json();
                    setDocuments(data.jobs || []);
                }
            } catch (error) {
                console.error("Failed to fetch history:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchHistory();
    }, []);

    // KELİME SAYISI HATASI ÇÖZÜMÜ: Etiketlerin yerine boşluk koyarak sayıyoruz
    const getWordCount = (html: string) => {
        if (!html) return 0;
        const text = html.replace(/<[^>]*>?/gm, ' ');
        return text.split(/\s+/).filter(word => word.length > 0).length;
    };

    // BAŞLIK HATASI ÇÖZÜMÜ: Artık veritabanına kaydettiğimiz gerçek title'ı çekiyoruz
    const getDocumentTitle = (doc: any) => {
        if (doc.inputPayload?.title) return doc.inputPayload.title;
        const match = doc.outputContent?.match(/<h[1-2][^>]*>(.*?)<\/h[1-2]>/);
        if (match && match[1]) return match[1].replace(/<[^>]+>/g, '');
        return "Generated SEO Article";
    };

    const formatDate = (dateString: string) => {
        const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        return new Date(dateString).toLocaleDateString(undefined, options);
    };

    // SİLME İŞLEMİ EKLENDİ
    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this document?")) return;
        try {
            const res = await fetch(`/api/documents/delete?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                setDocuments(docs => docs.filter(d => d.id !== id));
            }
        } catch (error) {
            alert("Failed to delete document.");
        }
    };

    const filteredDocuments = documents.filter((doc) => {
        const matchesSearch = getDocumentTitle(doc).toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = statusFilter === "All" || doc.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    return (
        <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white transition-colors">
                        Document History
                    </h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 transition-colors">
                        Manage, edit, and export all your previously generated content.
                    </p>
                </div>
                <Link
                    href="/dashboard/generator"
                    className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                    + New Document
                </Link>
            </div>

            {/* FİLTRE EKRANI TASARIM KAYMASI ÇÖZÜMÜ */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 flex flex-col md:flex-row gap-4 justify-between items-center shadow-sm transition-colors">
                <div className="relative w-full md:w-1/2">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search in your documents..."
                        className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg leading-5 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors"
                    />
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                    <div className="relative w-full sm:w-48">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Filter className="w-4 h-4 text-gray-500" />
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="block w-full pl-9 pr-8 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none transition-colors appearance-none cursor-pointer"
                        >
                            <option value="All">All Statuses</option>
                            <option value="COMPLETED">Completed</option>
                            <option value="PROCESSING">Processing</option>
                            <option value="FAILED">Failed</option>
                        </select>
                    </div>
                    <button className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <Calendar className="w-4 h-4 mr-2 text-gray-500" />
                        Date Sort
                    </button>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-900 shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden transition-colors min-h-[400px]">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-64 space-y-4">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                        <p className="text-gray-500 dark:text-gray-400 font-medium">Fetching your documents...</p>
                    </div>
                ) : filteredDocuments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 space-y-4 text-center px-4">
                        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                            <FileText className="w-8 h-8 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">No documents found</h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-sm">
                            {searchQuery ? "No documents match your current search or filter criteria." : "You haven't generated any content yet. Start by creating a new document."}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
                            <thead className="bg-gray-50 dark:bg-gray-800/50">
                                <tr>
                                    <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Document Name</th>
                                    <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                                    <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Word Count</th>
                                    <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
                                    <th scope="col" className="px-6 py-4 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
                                {filteredDocuments.map((doc) => (
                                    <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <div className="flex-shrink-0 h-10 w-10 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center">
                                                    <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                                </div>
                                                <div className="ml-4">
                                                    <div className="text-sm font-bold text-gray-900 dark:text-white truncate max-w-xs sm:max-w-sm">
                                                        {getDocumentTitle(doc)}
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-medium">
                                                        {doc.tool?.name || doc.aiModel.replace(/_/g, ' ')}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={cn(
                                                "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                                                doc.status === 'COMPLETED' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                    doc.status === 'FAILED' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                                        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                            )}>
                                                {doc.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-600 dark:text-gray-300">
                                            {getWordCount(doc.outputContent).toLocaleString()} words
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                            {formatDate(doc.createdAt)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Open in Editor">
                                                    <Edit3 className="w-4 h-4" />
                                                </button>
                                                {doc.status === 'COMPLETED' && (
                                                    <button className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Export">
                                                        <ExternalLink className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {/* SİLME BUTONU AKTİF EDİLDİ */}
                                                <button
                                                    onClick={() => handleDelete(doc.id)}
                                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Delete"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}