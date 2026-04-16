"use client";

import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowRight, Target, FileText, Send } from "lucide-react";
import { KeywordResult } from "@/types/keyword-lab";

interface TopicIdeaCardProps {
    idea: KeywordResult["topicIdeas"][0];
    seedKeyword: string;
}

export default function TopicIdeaCard({ idea, seedKeyword }: TopicIdeaCardProps) {
    const locale = useLocale();

    // Constructs the bridge URL to pass data to the Generator module safely
    const generatorUrl = `/${locale}/generator?seed=${encodeURIComponent(seedKeyword)}&topic=${encodeURIComponent(idea.title)}`;

    return (
        <div className="p-5 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between h-full">
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <span className="px-2.5 py-1 text-xs font-semibold bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-full uppercase tracking-wider">
                        {idea.format}
                    </span>
                </div>
                <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-3 line-clamp-2">
                    {idea.title}
                </h4>
                <div className="space-y-2 mb-6">
                    <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Target size={16} className="mt-0.5 flex-shrink-0" />
                        <span className="line-clamp-1"><strong className="font-medium">Audience:</strong> {idea.targetAudience}</span>
                    </div>
                    <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <FileText size={16} className="mt-0.5 flex-shrink-0" />
                        <span className="line-clamp-2"><strong className="font-medium">Angle:</strong> {idea.angle}</span>
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