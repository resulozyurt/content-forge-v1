"use client";

import { useState } from "react";
import { KeywordResult } from "@/types/keyword-lab";
import TopicIdeaCard from "./TopicIdeaCard";
import {
    AlertCircle, List, TrendingUp, Sparkles, Lightbulb, Wrench,
    Target, LayoutTemplate, Zap, Code, FileText
} from "lucide-react";

interface ClusterResultsProps {
    data: KeywordResult;
    seedKeyword: string;
}

const TABS = [
    { id: "topics", label: "Topic Ideas", icon: Lightbulb },
    { id: "seo", label: "SEO Opportunities", icon: TrendingUp },
    { id: "clusters", label: "Clusters", icon: List },
    { id: "ai", label: "AI Overviews", icon: Sparkles },
    { id: "tactics", label: "Tactical Tips", icon: Wrench },
];

export default function ClusterResults({ data, seedKeyword }: ClusterResultsProps) {
    const [activeTab, setActiveTab] = useState(TABS[0].id);

    return (
        <div className="w-full space-y-6 animate-in fade-in duration-500">
            {/* Anti-Hallucination Disclaimer */}
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4 flex items-start gap-3 shadow-sm">
                <AlertCircle className="text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" size={20} />
                <p className="text-sm text-amber-800 dark:text-amber-300">
                    <strong className="font-semibold">Stratejik Not:</strong> Listelenen veriler semantik analiz ve SEO niyet tahminine dayanır. Gerçek arama hacimlerini ve rekabet metriklerini doğrulamak için Google Search Console veya Ahrefs gibi araçları kullanmanız önerilir.
                </p>
            </div>

            {/* Tabs Navigation */}
            <div className="flex space-x-2 border-b border-gray-200 dark:border-gray-800 overflow-x-auto pb-px scrollbar-hide">
                {TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-all ${isActive
                                    ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10 rounded-t-lg"
                                    : "border-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800/50 rounded-t-lg"
                                }`}
                        >
                            <tab.icon size={16} className={isActive ? "animate-pulse-once" : ""} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content Rendering */}
            <div className="py-2">

                {/* TOPIC IDEAS TAB */}
                {activeTab === "topics" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {data.topicIdeas.map((idea, idx) => (
                            <TopicIdeaCard key={idx} idea={idea} seedKeyword={seedKeyword} />
                        ))}
                    </div>
                )}

                {/* SEO OPPORTUNITIES TAB */}
                {activeTab === "seo" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {data.seoOpportunities.map((item, idx) => (
                            <div key={idx} className="p-5 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition-shadow">
                                <div className="flex justify-between items-start mb-3 gap-2">
                                    <h5 className="font-bold text-gray-900 dark:text-white leading-tight">{item.keyword}</h5>
                                    <span className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full font-bold flex-shrink-0 ${item.competition === 'low' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                                            item.competition === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                                                'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                        }`}>
                                        {item.competition} COMP
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-4">
                                    <span className="text-xs px-2.5 py-1.5 bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 rounded-lg flex items-center gap-1.5 font-medium border border-blue-100 dark:border-blue-800/30">
                                        <Target size={14} /> {item.type}
                                    </span>
                                    <span className="text-xs px-2.5 py-1.5 bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400 rounded-lg flex items-center gap-1.5 font-medium border border-purple-100 dark:border-purple-800/30">
                                        <LayoutTemplate size={14} /> {item.format}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* CLUSTERS TAB */}
                {activeTab === "clusters" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {data.clusterKeywords.map((item, idx) => (
                            <div key={idx} className="p-4 border border-gray-200 dark:border-gray-800 rounded-xl flex justify-between items-center bg-white dark:bg-gray-900 shadow-sm group hover:border-blue-200 dark:hover:border-blue-900 transition-colors">
                                <span className="font-semibold text-gray-800 dark:text-gray-200">{item.keyword}</span>
                                <span className={`text-xs px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider ${item.intent === 'informational' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' :
                                        item.intent === 'commercial' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' :
                                            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    }`}>
                                    {item.intent}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {/* AI OVERVIEWS TAB */}
                {activeTab === "ai" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {data.aiOverviewKeywords.map((item, idx) => (
                            <div key={idx} className="p-5 border border-indigo-100 dark:border-indigo-800/50 bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-900/10 dark:to-gray-900 rounded-xl flex gap-4 items-start shadow-sm">
                                <div className="p-2.5 bg-indigo-100 dark:bg-indigo-900/40 rounded-xl text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0 shadow-inner">
                                    <Sparkles size={20} />
                                </div>
                                <div>
                                    <h5 className="font-bold text-gray-900 dark:text-white text-base mb-1.5">{item.keyword}</h5>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{item.reason}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* TACTICAL TIPS TAB */}
                {activeTab === "tactics" && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        {data.tacticalTips.map((item, idx) => {
                            const isTech = item.category === 'technical';
                            const isOnPage = item.category === 'on-page';

                            return (
                                <div key={idx} className="p-5 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 flex gap-4 items-start shadow-sm transition-transform hover:-translate-y-0.5">
                                    <div className={`p-2.5 rounded-xl flex-shrink-0 shadow-inner ${isOnPage ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400' :
                                            isTech ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400' :
                                                'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                                        }`}>
                                        {isOnPage ? <FileText size={20} /> : isTech ? <Code size={20} /> : <Zap size={20} />}
                                    </div>
                                    <div>
                                        <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5 block">
                                            {item.category.replace('-', ' ')}
                                        </span>
                                        <p className="text-sm text-gray-800 dark:text-gray-300 font-medium leading-relaxed">{item.tip}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

            </div>
        </div>
    );
}