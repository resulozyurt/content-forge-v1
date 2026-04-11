// apps/web/src/components/generator/GeneratorConfig.tsx
"use client";

import { useState } from "react";
import { Search, Sparkles, Settings2, Globe, BrainCircuit, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { GeneratorConfigData, initialConfigData, ContentType, Language, AIModel, Tone, ContentDepth } from "@/types/generator";

interface GeneratorConfigProps {
    onStartResearch: (config: GeneratorConfigData) => void;
}

export default function GeneratorConfig({ onStartResearch }: GeneratorConfigProps) {
    const [config, setConfig] = useState<GeneratorConfigData>(initialConfigData);
    const [showAdvanced, setShowAdvanced] = useState(false);

    const updateConfig = (field: keyof GeneratorConfigData, value: any) => {
        setConfig((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!config.query.trim()) return;
        onStartResearch(config);
    };

    return (
        <div className="w-full max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
                    What do you want to write about?
                </h1>
                <p className="text-gray-500 dark:text-gray-400 text-lg">
                    We will research your topic, analyze the SERP, and create an optimized outline.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden transition-colors">

                {/* Top Section: The Main Query */}
                <div className="p-6 sm:p-8 border-b border-gray-100 dark:border-gray-800">
                    <div className="flex flex-col sm:flex-row items-center gap-4 text-lg">
                        <span className="text-gray-600 dark:text-gray-400 whitespace-nowrap">I want to write a</span>

                        <select
                            value={config.contentType}
                            onChange={(e) => updateConfig('contentType', e.target.value as ContentType)}
                            className="bg-transparent border-b-2 border-dashed border-gray-300 dark:border-gray-700 text-blue-600 dark:text-blue-400 font-semibold focus:outline-none focus:border-blue-600 cursor-pointer pb-1 text-center sm:text-left"
                        >
                            <option value="blog_post">Blog Post</option>
                            <option value="pillar_page">Pillar Page</option>
                            <option value="guide">Ultimate Guide</option>
                            <option value="product_review">Product Review</option>
                            <option value="service_page">Service Page</option>
                        </select>

                        <span className="text-gray-600 dark:text-gray-400 whitespace-nowrap">about</span>
                    </div>

                    <div className="mt-6 relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <Search className="h-6 w-6 text-gray-400" />
                        </div>
                        <input
                            type="text"
                            value={config.query}
                            onChange={(e) => updateConfig('query', e.target.value)}
                            placeholder="e.g. best project management software for agencies"
                            className="block w-full pl-12 pr-4 py-4 text-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                            autoFocus
                            required
                        />
                    </div>
                </div>

                {/* Advanced Settings Toggle */}
                <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-gray-50 dark:bg-gray-800/30 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors border-b border-gray-100 dark:border-gray-800"
                >
                    <Settings2 className="w-4 h-4" />
                    {showAdvanced ? "Hide AI & Targeting Settings" : "Show AI & Targeting Settings"}
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {/* Advanced Settings Panel */}
                {showAdvanced && (
                    <div className="p-6 sm:p-8 bg-gray-50/50 dark:bg-gray-800/10 grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2 duration-300">

                        {/* AI Model */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                                <BrainCircuit className="w-4 h-4 text-purple-500" /> AI Engine
                            </label>
                            <select
                                value={config.model}
                                onChange={(e) => updateConfig('model', e.target.value as AIModel)}
                                className="w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white shadow-sm focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (Best for Writing)</option>
                                <option value="gpt-4o">GPT-4o (Best for Logic)</option>
                            </select>
                        </div>

                        {/* Language */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                                <Globe className="w-4 h-4 text-green-500" /> Output Language
                            </label>
                            <select
                                value={config.language}
                                onChange={(e) => updateConfig('language', e.target.value as Language)}
                                className="w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white shadow-sm focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="en">English (US)</option>
                                <option value="tr">Türkçe (TR)</option>
                            </select>
                        </div>

                        {/* Tone of Voice */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                                <FileText className="w-4 h-4 text-orange-500" /> Tone of Voice
                            </label>
                            <select
                                value={config.tone}
                                onChange={(e) => updateConfig('tone', e.target.value as Tone)}
                                className="w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white shadow-sm focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="professional">Professional & Authoritative</option>
                                <option value="casual">Casual & Conversational</option>
                                <option value="educational">Educational & Explanatory</option>
                                <option value="persuasive">Persuasive & Sales-driven</option>
                            </select>
                        </div>

                        {/* Content Depth */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                                <Settings2 className="w-4 h-4 text-blue-500" /> Content Depth
                            </label>
                            <select
                                value={config.depth}
                                onChange={(e) => updateConfig('depth', e.target.value as ContentDepth)}
                                className="w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white shadow-sm focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="standard">Standard (Overview)</option>
                                <option value="comprehensive">Comprehensive (In-depth Analysis)</option>
                                <option value="exhaustive">Exhaustive (Pillar Content)</option>
                            </select>
                        </div>

                    </div>
                )}

                {/* Action Bar */}
                <div className="p-6 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex justify-end">
                    <button
                        type="submit"
                        disabled={!config.query.trim()}
                        className="inline-flex items-center justify-center px-8 py-3.5 text-base font-bold text-white transition-all transform bg-gradient-to-r from-blue-600 to-indigo-600 border border-transparent rounded-xl shadow-md hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02]"
                    >
                        <Sparkles className="w-5 h-5 mr-2" />
                        Start Research Process
                    </button>
                </div>
            </form>
        </div>
    );
}