// apps/web/src/app/[locale]/(app)/history/page.tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { Search, FileText, Trash2, ExternalLink, Loader2, Edit3 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function HistoryPage() {
    const [documents, setDocuments] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("All");
    const locale = useLocale();

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const res = await fetch("/api/documents/history");
                if (res.ok) {
                    const data = await res.json();
                    const jobs: any[] = data.jobs || [];

                    // Deduplicate: for identical outputContent, keep only the most recent record.
                    // This prevents "Untitled Draft" duplicates caused by ProseEditor's
                    // double-save bug (now fixed, but old records may already exist).
                    const seen = new Map<string, any>();
                    for (const job of jobs) {
                        // Use the first 200 chars of content as a dedup key
                        const contentKey = (job.outputContent || "").slice(0, 200);
                        if (!seen.has(contentKey)) {
                            seen.set(contentKey, job);
                        } else {
                            // Keep whichever record has a better title
                            const existing = seen.get(contentKey);
                            const existingTitle = getDocumentTitle(existing);
                            const newTitle = getDocumentTitle(job);
                            if (
                                existingTitle === "Generated SEO Document" ||
                                existingTitle === "Untitled Draft"
                            ) {
                                seen.set(contentKey, job);
                            } else if (newTitle !== "Generated SEO Document" && newTitle !== "Untitled Draft") {
                                // Both have real titles — keep the newer one (list is already sorted newest-first)
                            }
                        }
                    }

                    setDocuments(Array.from(seen.values()));
                }
            } catch (err) {
                console.error("[HISTORY_FETCH_FAULT]:", err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchHistory();
    }, []);

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------
    function getDocumentTitle(doc: any): string {
        // Try every possible location for the real title
        if (doc.inputPayload?.title && doc.inputPayload.title !== "Generated SEO Article") {
            return doc.inputPayload.title;
        }
        if (doc.seoMetadata?.metaTitle) return doc.seoMetadata.metaTitle;
        if (doc.inputPayload?.seoMetadata?.metaTitle) return doc.inputPayload.seoMetadata.metaTitle;
        if (doc.inputPayload?.query) return doc.inputPayload.query;
        // Parse the H1 or H2 out of the saved HTML
        const match = doc.outputContent?.match(/<h[12][^>]*>(.*?)<\/h[12]>/i);
        if (match?.[1]) return match[1].replace(/<[^>]+>/g, "").trim();
        return "Generated SEO Document";
    }

    function getWordCount(html: string): number {
        if (!html) return 0;
        return html
            .replace(/<[^>]*>/gm, " ")
            .split(/\s+/)
            .filter((w) => w.length > 0).length;
    }

    function formatDate(dateString: string): string {
        return new Date(dateString).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    const handleDelete = async (id: string) => {
        if (!confirm("Permanently delete this document?")) return;
        try {
            const res = await fetch(`/api/documents/delete?id=${id}`, { method: "DELETE" });
            if (res.ok) setDocuments((docs) => docs.filter((d) => d.id !== id));
        } catch {
            alert("Failed to delete document.");
        }
    };

    const handleExport = (doc: any) => {
        const html = doc.outputContent || "<p>No content available.</p>";
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${getDocumentTitle(doc).replace(/\s+/g, "_").toLowerCase()}.html`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const filtered = documents.filter((doc) => {
        const matchesSearch = getDocumentTitle(doc)
            .toLowerCase()
            .includes(searchQuery.toLowerCase());
        const matchesStatus = statusFilter === "All" || doc.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    return (
        <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Document History</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Manage, edit, and export all your previously generated content.
                    </p>
                </div>
                <div className="text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-lg">
                    {filtered.length} document{filtered.length !== 1 ? "s" : ""}
                </div>
            </div>

            {/* Search + filter bar */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search in your documents..."
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="All">All Statuses</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="FAILED">Failed</option>
                </select>
            </div>

            {/* Document table */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-64 space-y-4">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                        <p className="text-gray-500 dark:text-gray-400 font-medium">Loading documents...</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 space-y-4 text-center px-4">
                        <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600" />
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">No documents found</h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-sm text-sm">
                            {searchQuery
                                ? "No documents match your search."
                                : "You haven't generated any content yet."}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
                            <thead className="bg-gray-50 dark:bg-gray-800/50">
                                <tr>
                                    {["Document Name", "Status", "Word Count", "Created", "Actions"].map((col) => (
                                        <th
                                            key={col}
                                            scope="col"
                                            className="px-6 py-4 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                                        >
                                            {col}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
                                {filtered.map((doc) => (
                                    <tr
                                        key={doc.id}
                                        className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group cursor-pointer"
                                        onClick={() =>
                                            (window.location.href = `/${locale}/editor/${doc.id}`)
                                        }
                                    >
                                        {/* Document name */}
                                        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                            <Link
                                                href={`/${locale}/editor/${doc.id}`}
                                                className="flex items-center gap-3 group/link"
                                            >
                                                <div className="flex-shrink-0 h-10 w-10 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center">
                                                    <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                                </div>
                                                <div className="overflow-hidden">
                                                    <div className="text-sm font-bold text-gray-900 dark:text-white truncate group-hover/link:text-blue-600 dark:group-hover/link:text-blue-400 transition-colors">
                                                        {getDocumentTitle(doc)}
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-medium uppercase tracking-wider">
                                                        {doc.aiModel?.replace(/_/g, " ") || "AI MODEL"}
                                                    </div>
                                                </div>
                                            </Link>
                                        </td>

                                        {/* Status */}
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span
                                                className={cn(
                                                    "inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                                    doc.status === "COMPLETED"
                                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                        : doc.status === "FAILED"
                                                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                            : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                                )}
                                            >
                                                {doc.status}
                                            </span>
                                        </td>

                                        {/* Word count */}
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300 font-medium">
                                            {getWordCount(doc.outputContent).toLocaleString()} words
                                        </td>

                                        {/* Date */}
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                            {formatDate(doc.createdAt)}
                                        </td>

                                        {/* Actions */}
                                        <td
                                            className="px-6 py-4 whitespace-nowrap text-right"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div className="flex items-center justify-end gap-2">
                                                <Link
                                                    href={`/${locale}/editor/${doc.id}`}
                                                    title="Open in editor"
                                                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                                >
                                                    <Edit3 size={15} />
                                                </Link>
                                                <button
                                                    title="Export as HTML"
                                                    onClick={() => handleExport(doc)}
                                                    className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                                                >
                                                    <ExternalLink size={15} />
                                                </button>
                                                <button
                                                    title="Delete document"
                                                    onClick={() => handleDelete(doc.id)}
                                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                >
                                                    <Trash2 size={15} />
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