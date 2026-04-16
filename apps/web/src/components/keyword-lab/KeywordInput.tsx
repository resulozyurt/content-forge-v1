"use client";

import { useState } from "react";
import { Search, Loader2 } from "lucide-react";

// Props for the input component to pass the submitted keyword back to the parent
interface KeywordInputProps {
    onSubmit: (keyword: string) => void;
    isLoading: boolean;
}

export default function KeywordInput({ onSubmit, isLoading }: KeywordInputProps) {
    const [keyword, setKeyword] = useState("");

    // Handles form submission, preventing default reload
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (keyword.trim().length >= 2 && !isLoading) {
            onSubmit(keyword.trim());
        }
    };

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
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
        </form>
    );
}