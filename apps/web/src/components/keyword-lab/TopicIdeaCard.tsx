"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowRight, Target, FileText, Send } from "lucide-react";
import { KeywordResult } from "@/types/keyword-lab";
import InfoTooltip from "./InfoTooltip";

interface TopicIdeaCardProps {
    idea: KeywordResult["topicIdeas"][0];
    seedKeyword: string;
}

// Hover explanations for each content format badge — written for first-time
// users so every label on the card is self-explanatory.
const FORMAT_INFO: Record<KeywordResult["topicIdeas"][0]["format"], string> = {
    guide: "A comprehensive how-to article that walks readers through the topic from start to finish. Great for building authority.",
    comparison: "An article that puts two or more options side by side, helping readers pick the right one. Great for buyers doing research.",
    "case-study": "A real-world story showing how a problem was solved and the results that followed. Great for building trust with proof.",
    listicle: "A numbered list article (like \"Top 10...\"). Easy to scan, easy to share, and a favorite format for quick readers.",
    tutorial: "A hands-on, step-by-step lesson readers can follow along with to get something done.",
};

const AUDIENCE_INFO =
    "Who this article is written for. Speaking to one specific reader — instead of everyone — makes content far more likely to rank and convert.";

const ANGLE_INFO =
    "The unique point of view that sets this article apart from everything already ranking on Google. Same topic, fresh take.";

export default function TopicIdeaCard({ idea, seedKeyword }: TopicIdeaCardProps) {
    const locale = useLocale();

    // Constructs the bridge URL to pass data to the Generator module safely
    const generatorUrl = `/${locale}/generator?seed=${encodeURIComponent(seedKeyword)}&topic=${encodeURIComponent(idea.title)}`;

    return (
        <div className="p-5 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between h-full">
            <div>
                <div className="flex items-center gap-2 mb-3">
                    {/* Format badge with hover explanation */}
                    <InfoTooltip text={FORMAT_INFO[idea.format] ?? "The type of article this idea is best suited for."}>
                        <span className="px-2.5 py-1 text-xs font-semibold bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-full uppercase tracking-wider">
                            {idea.format}
                        </span>
                    </InfoTooltip>
                </div>
                {/* Full title — no truncation, wraps to as many lines as needed */}
                <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-3">
                    {idea.title}
                </h4>
                <div className="space-y-2 mb-6">
                    <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Target size={16} className="mt-0.5 flex-shrink-0" />
                        {/* Full audience line — label carries a hover explanation */}
                        <span>
                            <InfoTooltip text={AUDIENCE_INFO}>
                                <strong className="font-medium border-b border-dotted border-gray-400 dark:border-gray-500">Audience:</strong>
                            </InfoTooltip>{" "}
                            {idea.targetAudience}
                        </span>
                    </div>
                    <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <FileText size={16} className="mt-0.5 flex-shrink-0" />
                        {/* Full angle sentence — label carries a hover explanation */}
                        <span>
                            <InfoTooltip text={ANGLE_INFO}>
                                <strong className="font-medium border-b border-dotted border-gray-400 dark:border-gray-500">Angle:</strong>
                            </InfoTooltip>{" "}
                            {idea.angle}
                        </span>
                    </div>
                </div>
            </div>

            <Link
                href={generatorUrl}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-blue-50 dark:bg-gray-800 dark:hover:bg-blue-900/20 text-gray-700 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400 border border-gray-200 dark:border-gray-700 rounded-lg font-medium transition-colors group"
            >
                <Send size={16} />
                Send to AI Generator
                <ArrowRight size={16} className="opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
            </Link>
        </div>
    );
}