"use client";

import { useCallback, useEffect, useState } from "react";
import {
    History, Search, Trash2, ArrowLeft, AlertCircle, ChevronRight, Loader2,
} from "lucide-react";
import ClusterResults from "./ClusterResults";
import { KeywordResult, KeywordSessionSummary } from "@/types/keyword-lab";

// ---------------------------------------------------------------------------
// HistoryPanel — the "History" tab of Keyword Lab.
// List view: the user's past analyses (newest first, paginated via Load More).
// Detail view: fetches the stored results for one session and renders them
// through the exact same ClusterResults component used for live analyses.
// ---------------------------------------------------------------------------

interface HistoryDetailState {
    summary: KeywordSessionSummary;
    results: KeywordResult;
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export default function HistoryPanel() {
    const [sessions, setSessions] = useState<KeywordSessionSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [isLoadingList, setIsLoadingList] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [detail, setDetail] = useState<HistoryDetailState | null>(null);

    const fetchList = useCallback(async (pageToLoad: number, append: boolean) => {
        append ? setIsLoadingMore(true) : setIsLoadingList(true);
        setError(null);

        try {
            const response = await fetch(`/api/keyword-lab/history?page=${pageToLoad}`);
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to load history");
            }
            const data = await response.json();
            setSessions((prev) => (append ? [...prev, ...data.sessions] : data.sessions));
            setTotal(data.total);
            setPage(pageToLoad);
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred while loading history.");
        } finally {
            append ? setIsLoadingMore(false) : setIsLoadingList(false);
        }
    }, []);

    // Fresh list every time the tab mounts, so a just-finished analysis shows up.
    useEffect(() => {
        fetchList(1, false);
    }, [fetchList]);

    const handleOpenDetail = async (summary: KeywordSessionSummary) => {
        setIsLoadingDetail(true);
        setError(null);

        try {
            const response = await fetch(`/api/keyword-lab/history?id=${encodeURIComponent(summary.id)}`);
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to load session");
            }
            const data = await response.json();
            setDetail({ summary, results: data.session.results as KeywordResult });
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred while loading the session.");
        } finally {
            setIsLoadingDetail(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation(); // Row click opens the detail — don't trigger it.
        if (!window.confirm("Delete this analysis from your history?")) return;

        setDeletingId(id);
        setError(null);

        try {
            const response = await fetch(`/api/keyword-lab/history?id=${encodeURIComponent(id)}`, {
                method: "DELETE",
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to delete session");
            }
            setSessions((prev) => prev.filter((s) => s.id !== id));
            setTotal((prev) => Math.max(0, prev - 1));
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred while deleting the session.");
        } finally {
            setDeletingId(null);
        }
    };

    // ---------------- Detail view ----------------
    if (detail) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <button
                        onClick={() => setDetail(null)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                        <ArrowLeft size={16} />
                        Back to History
                    </button>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                        Analyzed on {formatDate(detail.summary.createdAt)}
                    </span>
                </div>
                <ClusterResults data={detail.results} seedKeyword={detail.summary.seedKeyword} />
            </div>
        );
    }

    // ---------------- List view ----------------
    return (
        <div className="space-y-4">
            {error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-2 text-sm">
                    <AlertCircle size={16} />
                    {error}
                </div>
            )}

            {isLoadingList ? (
                <div className="flex flex-col items-center justify-center h-[400px] text-gray-500">
                    <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                    <p className="animate-pulse">Loading your analysis history...</p>
                </div>
            ) : sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[400px] border border-dashed border-gray-300 dark:border-gray-800 rounded-xl bg-gray-50 dark:bg-gray-900/50">
                    <History size={32} className="text-gray-400 mb-3" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        No analyses yet. Run your first keyword analysis to see it here.
                    </p>
                </div>
            ) : (
                <>
                    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                        {sessions.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => handleOpenDetail(s)}
                                disabled={isLoadingDetail}
                                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group disabled:opacity-60"
                            >
                                <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                                    <Search size={16} className="text-blue-600 dark:text-blue-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate capitalize">
                                        {s.seedKeyword}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {formatDate(s.createdAt)}
                                    </p>
                                </div>
                                <span
                                    role="button"
                                    aria-label="Delete analysis"
                                    onClick={(e) => handleDelete(e, s.id)}
                                    className="flex-shrink-0 p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors"
                                >
                                    {deletingId === s.id ? (
                                        <Loader2 size={16} className="animate-spin" />
                                    ) : (
                                        <Trash2 size={16} />
                                    )}
                                </span>
                                <ChevronRight
                                    size={16}
                                    className="flex-shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all"
                                />
                            </button>
                        ))}
                    </div>

                    {sessions.length < total && (
                        <div className="flex justify-center">
                            <button
                                onClick={() => fetchList(page + 1, true)}
                                disabled={isLoadingMore}
                                className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-60 flex items-center gap-2"
                            >
                                {isLoadingMore && <Loader2 size={14} className="animate-spin" />}
                                Load More ({total - sessions.length} remaining)
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}