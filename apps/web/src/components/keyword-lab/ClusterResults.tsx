"use client";

import { useState } from "react";
import { KeywordResult } from "@/types/keyword-lab";
import TopicIdeaCard from "./TopicIdeaCard";
import { AlertCircle, List, TrendingUp, Sparkles, Lightbulb, Wrench } from "lucide-react";

interface ClusterResultsProps {
    data: KeywordResult;
    seedKeyword: string;
}

const TABS = [
    { id: "clusters", label: "Clusters", icon: List },
    { id: "seo", label: "SEO Opportunities", icon: TrendingUp },
    { id: "ai", label: "AI Overviews", icon: Sparkles },
    { id: "topics", label: "Topic Ideas", icon: Lightbulb },
    { id: "tactics", label: "Tactical Tips", icon: Wrench },
];

export default function ClusterResults({ data, seedKeyword }: ClusterResultsProps) {
    const [activeTab, setActiveTab] = useState(TABS[0].id);

    return (
        <div className="w-full space-y-6">
            {/* Anti-Hallucination Disclaimer */}
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" size={20} />
                <p className="text-sm text-amber-800 dark:text-amber-400">
                    <strong>Önemli Not:</strong> Listelenen veriler semantik analiz ve SEO niyet tahminidir. Arama hacimlerini ve rekabet metriklerini doğrulamak için Google Search Console veya Ahrefs kullanın.
                </p>
            </div>

            {/* Tabs Navigation */}
            <div className="flex space-x-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto pb-px">
                {TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${isActive
                                    ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-400"
                                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
                                }`}
                        >
                            <tab.icon size={16} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content Rendering */}
            <div className="py-4">
                {/* Topics Tab - High Priority for Integration */}
                {activeTab === "topics" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {data.topicIdeas.map((idea, idx) => (
                            <TopicIdeaCard key={idx} idea={idea} seedKeyword={seedKeyword} />
                        ))}
                    </div>
                )}

                {/* Clusters Tab */}
                {activeTab === "clusters" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {data.clusterKeywords.map((item, idx) => (
                            <div key={idx} className="p-4 border border-gray-200 dark:border-gray-800 rounded-lg flex justify-between items-center bg-white dark:bg-gray-900">
                                <span className="font-medium dark:text-white">{item.keyword}</span>
                                <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-gray-600 dark:text-gray-300 uppercase tracking-wider">{item.intent}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Fallback for other tabs to keep scope focused for now */}
                {["seo", "ai", "tactics"].includes(activeTab) && (
                    <div className="text-center py-12 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
                        <p className="text-gray-500 dark:text-gray-400">
                            Data for {activeTab} loaded successfully. (We will expand UI for these later).
                        </p>
                        <pre className="text-left mt-4 p-4 bg-gray-50 dark:bg-gray-950 rounded text-xs overflow-auto text-gray-600 dark:text-gray-300">
                            {JSON.stringify(
                                activeTab === "seo" ? data.seoOpportunities :
                                    activeTab === "ai" ? data.aiOverviewKeywords : data.tacticalTips,
                                null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}