"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, FlaskConical, History } from "lucide-react";
import KeywordInput from "@/components/keyword-lab/KeywordInput";
import ClusterResults from "@/components/keyword-lab/ClusterResults";
import HistoryPanel from "@/components/keyword-lab/HistoryPanel";
import { KeywordResult } from "@/types/keyword-lab";

type LabTab = "analyze" | "history";

export default function KeywordLabPage() {
    // const t = useTranslations("KeywordLab"); // Ready for i18n when needed

    // Tab state — "analyze" keeps the original flow, "history" shows past sessions.
    const [activeTab, setActiveTab] = useState<LabTab>("analyze");

    // State management for API interaction
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<KeywordResult | null>(null);
    const [currentKeyword, setCurrentKeyword] = useState<string>("");

    // Handles the keyword submission, calls the Claude API, and parses the response
    const handleAnalyze = async (keyword: string) => {
        setIsLoading(true);
        setError(null);
        setCurrentKeyword(keyword);

        try {
            const response = await fetch("/api/keyword-lab", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ seedKeyword: keyword }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Analysis failed");
            }

            const result: KeywordResult = await response.json();
            setData(result);
        } catch (err: any) {
            console.error("Analysis Error:", err);
            setError(err.message || "An unexpected error occurred while analyzing the keyword.");
        } finally {
            setIsLoading(false);
        }
    };

    const tabs: Array<{ id: LabTab; label: string; icon: typeof FlaskConical }> = [
        { id: "analyze", label: "Analyze", icon: FlaskConical },
        { id: "history", label: "History", icon: History },
    ];

    return (
        <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                    Keyword Lab
                </h1>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    Discover structured content clusters, SEO opportunities, and AI tactical tips based on your seed keyword.
                </p>
            </div>

            {/* Tab bar */}
            <div className="mb-8 border-b border-gray-200 dark:border-gray-800">
                <nav className="flex gap-6" aria-label="Keyword Lab tabs">
                    {tabs.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={`flex items-center gap-2 px-1 pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                                activeTab === id
                                    ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                            }`}
                        >
                            <Icon size={16} />
                            {label}
                        </button>
                    ))}
                </nav>
            </div>

            {activeTab === "analyze" ? (
                <div className="space-y-8">
                    {/* Step 1: Input Area */}
                    <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
                        <KeywordInput onSubmit={handleAnalyze} isLoading={isLoading} />

                        {error && (
                            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-2 text-sm">
                                <AlertCircle size={16} />
                                {error}
                            </div>
                        )}
                    </div>

                    {/* Step 2: Results Area */}
                    <div className="min-h-[400px]">
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center h-[400px] text-gray-500">
                                <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                                <p className="animate-pulse">Analyzing search intent and clustering keywords...</p>
                            </div>
                        ) : data ? (
                            <ClusterResults data={data} seedKeyword={currentKeyword} />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-[400px] border border-dashed border-gray-300 dark:border-gray-800 rounded-xl bg-gray-50 dark:bg-gray-900/50">
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    Enter a seed keyword above to generate your strategy.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                // Remounted on each tab switch so the list is always fresh.
                <HistoryPanel />
            )}
        </div>
    );
}