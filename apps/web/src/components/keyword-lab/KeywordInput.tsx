"use client";

import { useState } from "react";
import { Search, Loader2, Users } from "lucide-react";
import { AUDIENCE_PRESETS, CUSTOM_AUDIENCE_VALUE, DEFAULT_AUDIENCE_VALUE } from "@/lib/audiences";

// Props for the input component to pass the submitted keyword back to the parent
interface KeywordInputProps {
    onSubmit: (keyword: string, audience: string, customAudience: string) => void;
    isLoading: boolean;
}

export default function KeywordInput({ onSubmit, isLoading }: KeywordInputProps) {
    const [keyword, setKeyword] = useState("");
    // Target audience — chosen before analysis; tailors the whole strategy.
    const [audience, setAudience] = useState(DEFAULT_AUDIENCE_VALUE);
    const [customAudience, setCustomAudience] = useState("");

    // Handles form submission, preventing default reload
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (keyword.trim().length >= 2 && !isLoading) {
            onSubmit(keyword.trim(), audience, customAudience.trim());
        }
    };

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto space-y-4">
            <div className="relative flex items-center">
                <Search className="absolute left-4 text-gray-400" size={20} />
                <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="Enter a seed keyword (e.g., b2b saas marketing)"
                    disabled={isLoading}
                    className="w-full pl-12 pr-32 py-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm disabled:opacity-50"
                />
                <button
                    type="submit"
                    disabled={isLoading || keyword.trim().length < 2}
                    className="absolute right-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                    {isLoading ? <Loader2 size={18} className="animate-spin" /> : "Analyze"}
                </button>
            </div>

            {/* Target audience — tailors clusters, opportunities, and topic ideas */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <label className="text-sm font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap flex items-center gap-1.5">
                    <Users size={16} className="text-indigo-500" /> Target audience
                </label>
                <select
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    disabled={isLoading}
                    className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                >
                    {AUDIENCE_PRESETS.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                    <option value={CUSTOM_AUDIENCE_VALUE}>Custom…</option>
                </select>
                {audience === CUSTOM_AUDIENCE_VALUE && (
                    <input
                        type="text"
                        value={customAudience}
                        onChange={(e) => setCustomAudience(e.target.value)}
                        placeholder="Describe your audience"
                        disabled={isLoading}
                        className="flex-1 min-w-0 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                )}
            </div>
        </form>
    );
}
