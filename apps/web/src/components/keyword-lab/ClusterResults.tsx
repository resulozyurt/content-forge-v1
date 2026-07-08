"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { KeywordResult } from "@/types/keyword-lab";
import TopicIdeaCard from "./TopicIdeaCard";
import InfoTooltip from "./InfoTooltip";
import {
    List, TrendingUp, Sparkles, Lightbulb, Wrench,
    Target, LayoutTemplate, Zap, Code, FileText, Send, ArrowRight
} from "lucide-react";

interface ClusterResultsProps {
    data: KeywordResult;
    seedKeyword: string;
}

// Shared bridge button. Keyword-only tabs (SEO, Clusters, AI Overviews) have no
// generated title, so the keyword itself is passed as the generator `topic`
// (same contract as TopicIdeaCard, which passes idea.title).
function SendToGeneratorButton({ seedKeyword, keyword }: { seedKeyword: string; keyword: string }) {
    const locale = useLocale();
    const generatorUrl = `/${locale}/generator?seed=${encodeURIComponent(seedKeyword)}&topic=${encodeURIComponent(keyword)}`;

    return (
        <Link
            href={generatorUrl}
            className="mt-auto w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-blue-50 dark:bg-gray-800 dark:hover:bg-blue-900/20 text-gray-700 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400 border border-gray-200 dark:border-gray-700 rounded-lg font-medium transition-colors group"
        >
            <Send size={16} />
            Send to AI Generator
            <ArrowRight size={16} className="opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
        </Link>
    );
}

// ---------------------------------------------------------------------------
// Hover explanations for the SEO Opportunities badges. Every colored element
// on a card gets a plain-English tooltip so first-time users know what they
// are looking at without leaving the page.
// ---------------------------------------------------------------------------

// Display labels for keyword types (CSS `capitalize` would render "lsi" as
// "Lsi", so we map to the proper form instead).
const SEO_TYPE_LABELS: Record<string, string> = {
    "long-tail": "Long-Tail",
    lsi: "LSI",
    question: "Question",
};

const SEO_TYPE_INFO: Record<string, string> = {
    "long-tail":
        "A longer, more specific search phrase. Fewer people search it, but they know exactly what they want — easier to rank for and better at converting.",
    lsi:
        "LSI (related term): a phrase Google expects to see alongside your main keyword. Covering it signals that your content is thorough and on-topic.",
    question:
        "A question people actually type into Google or ask voice assistants. Answer it clearly and you can win featured snippets and AI answers.",
};

const SEO_COMPETITION_INFO: Record<string, string> = {
    low: "Low competition: few strong pages rank for this yet, so a well-written article has a real shot at page one. Start here for the fastest wins.",
    medium: "Medium competition: rankable with a thorough, well-optimized article and a little patience.",
    high: "High competition: big, established sites rank here. Worth targeting long-term, but win the easier keywords first.",
};

const SEO_FORMAT_INFO =
    "The content format searchers expect for this keyword. Matching the format Google already rewards gives you a much better chance to rank.";

// The AI generates question keywords without trailing question marks
// (e.g. "what is invoice management"). Append one when the phrase starts
// with a question word, so question-type items read naturally in the UI.
const QUESTION_STARTERS = new Set([
    "what", "how", "why", "when", "where", "which", "who", "whose",
    "can", "could", "should", "would", "will", "do", "does", "did",
    "is", "are", "was", "were",
]);

function withQuestionMark(keyword: string): string {
    const trimmed = keyword.trim();
    if (!trimmed || /[?!.]$/.test(trimmed)) return trimmed;
    const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
    return QUESTION_STARTERS.has(firstWord) ? `${trimmed}?` : trimmed;
}

// Each tab carries its own icon + a plain-English, benefit-first description.
// The description swaps dynamically with the active tab (see info banner below).
// Each description answers three things for a first-time user: what am I looking
// at, how is this tab different from the others, and what should I do next.
const TABS = [
    {
        id: "topics",
        label: "Topic Ideas",
        icon: Lightbulb,
        description:
            "Complete article concepts, ready to write. Each card gives you a working title, the audience it's written for, and a fresh angle that sets it apart from what's already out there. Like one? Hit \"Send to AI Generator\" and it becomes a full draft.",
    },
    {
        id: "seo",
        label: "SEO Opportunities",
        icon: TrendingUp,
        description:
            "Specific search phrases you have a real shot at ranking for. Each card shows a keyword variation, how stiff the competition is, and the content format that works best for it. Start with the green low-competition cards — those are your quickest wins.",
    },
    {
        id: "clusters",
        label: "Keyword Clusters",
        icon: List,
        description:
            "The full map of what people search around your keyword. Each term is tagged by intent: informational means they want to learn, commercial means they're comparing options, and transactional means they're ready to buy. Use this to decide which searchers to go after first.",
    },
    {
        id: "ai",
        label: "AI Overviews",
        icon: Sparkles,
        description:
            "Google now answers many searches with an AI-written summary above the regular results. These are the searches in your topic most likely to trigger one — with the reason why. Create content for them and you can get cited in that box, above even the #1 ranking.",
    },
    {
        id: "tactics",
        label: "Tactical Tips",
        icon: Wrench,
        description:
            "Not keywords — this is your to-do list. Concrete improvements to make on your site, grouped into three types: on-page (your content), technical (your site's setup), and AI optimization (getting picked up by AI search). Check items off to help everything else here rank better.",
    },
];

export default function ClusterResults({ data, seedKeyword }: ClusterResultsProps) {
    const [activeTab, setActiveTab] = useState(TABS[0].id);

    // Resolve the active tab so the info banner can show its icon + description.
    const activeTabData = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
    const ActiveIcon = activeTabData.icon;

    return (
        <div className="w-full space-y-6 animate-in fade-in duration-500">
            {/* Dynamic, tab-aware explainer (replaces the old static disclaimer) */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl p-4 flex items-start gap-3 shadow-sm transition-colors">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg text-blue-600 dark:text-blue-400 flex-shrink-0 shadow-inner">
                    <ActiveIcon size={18} />
                </div>
                <div>
                    <strong className="block text-sm font-semibold text-blue-900 dark:text-blue-200 mb-0.5">
                        {activeTabData.label}
                    </strong>
                    <p className="text-sm text-blue-800 dark:text-blue-300 leading-relaxed">
                        {activeTabData.description}
                    </p>
                </div>
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
                            <div key={idx} className="p-5 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                                <div className="flex justify-between items-start mb-3 gap-2">
                                    {/* Title Case for keyword display */}
                                    <h5 className="font-bold text-gray-900 dark:text-white leading-tight capitalize">{item.keyword}</h5>
                                    {/* Competition badge with hover explanation */}
                                    <InfoTooltip text={SEO_COMPETITION_INFO[item.competition] ?? "How hard it is to rank for this keyword."}>
                                        <span className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full font-bold flex-shrink-0 ${item.competition === 'low' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                                                item.competition === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                                                    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                            }`}>
                                            {item.competition} COMP
                                        </span>
                                    </InfoTooltip>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-4 mb-5">
                                    {/* Keyword type badge (blue) with hover explanation */}
                                    <InfoTooltip text={SEO_TYPE_INFO[item.type] ?? "The kind of keyword this is."}>
                                        <span className="text-xs px-2.5 py-1.5 bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 rounded-lg flex items-center gap-1.5 font-medium border border-blue-100 dark:border-blue-800/30">
                                            <Target size={14} /> {SEO_TYPE_LABELS[item.type] ?? item.type}
                                        </span>
                                    </InfoTooltip>
                                    {/* Recommended format badge (purple) with hover explanation */}
                                    <InfoTooltip text={SEO_FORMAT_INFO}>
                                        <span className="text-xs px-2.5 py-1.5 bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400 rounded-lg flex items-center gap-1.5 font-medium border border-purple-100 dark:border-purple-800/30 capitalize">
                                            <LayoutTemplate size={14} /> {item.format}
                                        </span>
                                    </InfoTooltip>
                                </div>
                                <SendToGeneratorButton seedKeyword={seedKeyword} keyword={item.keyword} />
                            </div>
                        ))}
                    </div>
                )}

                {/* CLUSTERS TAB */}
                {activeTab === "clusters" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {data.clusterKeywords.map((item, idx) => (
                            <div key={idx} className="p-4 border border-gray-200 dark:border-gray-800 rounded-xl flex justify-between items-center bg-white dark:bg-gray-900 shadow-sm hover:border-blue-200 dark:hover:border-blue-900 transition-colors">
                                <span className="font-semibold text-gray-800 dark:text-gray-200">{item.keyword}</span>
                                <span className={`text-xs px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider flex-shrink-0 ${item.intent === 'informational' ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' :
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
                                    {/* Question-form keywords get their missing "?" appended */}
                                    <h5 className="font-bold text-gray-900 dark:text-white text-base mb-1.5 capitalize">{withQuestionMark(item.keyword)}</h5>
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