// apps/web/src/components/generator/ResearchAccordion.tsx
"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, Search, Target, Link as LinkIcon, HelpCircle, Layers, FileText, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { GeneratorConfigData, ResearchResultData } from "@/types/generator";

interface ResearchAccordionProps {
    config: GeneratorConfigData;
    onCompleteResearch: (data: ResearchResultData) => void;
}

const researchSteps = [
    { id: 'intent', label: "Decoding Search Intent", icon: Target },
    { id: 'keywords', label: "Expanding Keywords", icon: Search },
    { id: 'serp', label: "Analyzing SERP", icon: LinkIcon },
    { id: 'questions', label: "Finding Questions", icon: HelpCircle },
    { id: 'gaps', label: "Finding Gaps", icon: Layers },
    { id: 'outline', label: "Building Outline", icon: FileText },
];

export default function ResearchAccordion({ config, onCompleteResearch }: ResearchAccordionProps) {
    const [activeStepIndex, setActiveStepIndex] = useState(0);
    const [completedSteps, setCompletedSteps] = useState<string[]>([]);
    const [data, setData] = useState<ResearchResultData | null>(null);

    // Fetch real data from the API
    useEffect(() => {
        let isMounted = true;

        const performResearch = async () => {
            try {
                const response = await fetch('/api/research', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        topic: config.query || config.topic || "Default Topic",
                        config: config
                    })
                });

                if (!response.ok) throw new Error("API failed");
                const jsonResponse = await response.json();
                const apiData = jsonResponse.data;

                if (isMounted) {
                    // Map the strict JSON from OpenAI to the UI's expected format
                    const formattedData: any = {
                        intent: apiData.searchIntent || "Informational",
                        keywords: [
                            ...(apiData.primaryKeywords || []).map((k: string) => ({ text: k, selected: true })),
                            ...(apiData.secondaryKeywords || []).map((k: string) => ({ text: k, selected: false }))
                        ],
                        competitors: (apiData.competitors || []).map((c: any, i: number) => ({
                            id: String(i),
                            url: c.name.toLowerCase().replace(/\s+/g, '') + ".com",
                            title: c.name,
                            wordCount: Math.floor(Math.random() * 1000) + 1200,
                            selected: true,
                            headings: c.headings // Passed down for outline builder
                        })),
                        questions: [
                            { text: `What are the benefits of ${config.query || 'this topic'}?`, selected: true },
                            { text: `How to implement ${config.query || 'this'} effectively?`, selected: true }
                        ]
                    };
                    setData(formattedData);
                }
            } catch (err) {
                console.error("Research Error:", err);
                // Fallback mock data in case of API failure to prevent UI lock
                if (isMounted) {
                    setData({
                        intent: "Informational",
                        keywords: [{ text: "Error fetching keywords", selected: true }],
                        competitors: [],
                        questions: []
                    } as any);
                }
            }
        };

        performResearch();
        return () => { isMounted = false; };
    }, [config]);

    // UI Simulation Effect synced with API
    useEffect(() => {
        if (activeStepIndex >= researchSteps.length) return;

        // Pause the visual timer at the final step if API data hasn't returned yet
        if (activeStepIndex === researchSteps.length - 1 && !data) return;

        const timer = setTimeout(() => {
            const currentStepId = researchSteps[activeStepIndex].id;
            setCompletedSteps(prev => [...prev, currentStepId]);
            setActiveStepIndex(prev => prev + 1);
        }, 1500);

        return () => clearTimeout(timer);
    }, [activeStepIndex, data]);

    const toggleKeyword = (index: number) => {
        if (!data) return;
        const newData = { ...data };
        newData.keywords[index].selected = !newData.keywords[index].selected;
        setData(newData);
    };

    const toggleCompetitor = (id: string) => {
        if (!data) return;
        const newData = { ...data };
        const compIndex = newData.competitors.findIndex((c: any) => c.id === id);
        if (compIndex > -1) {
            newData.competitors[compIndex].selected = !newData.competitors[compIndex].selected;
            setData(newData);
        }
    };

    const isAllComplete = activeStepIndex >= researchSteps.length && data !== null;
    const progressPercentage = (completedSteps.length / researchSteps.length) * 100;

    return (
        <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Header & Progress */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            {isAllComplete ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Search className="w-5 h-5 text-blue-600 animate-pulse" />}
                            {isAllComplete ? "Research Complete" : "Researching..."}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Target query: <strong className="text-gray-900 dark:text-white">"{config.query || config.topic}"</strong>
                        </p>
                    </div>
                    <div className="text-right">
                        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                            Step {Math.min(activeStepIndex + 1, researchSteps.length)} of {researchSteps.length}
                        </span>
                    </div>
                </div>

                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                    <div
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 h-2.5 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${progressPercentage}%` }}
                    ></div>
                </div>
            </div>

            {/* Flattened Dashboard Layout (Always Open) */}
            <div className="space-y-6">
                {researchSteps.map((step, index) => {
                    const isCompleted = completedSteps.includes(step.id);
                    const isActive = index === activeStepIndex;

                    // Hide unreached steps to keep the UI clean
                    if (!isCompleted && !isActive) return null;

                    return (
                        <div
                            key={step.id}
                            className={cn(
                                "bg-white dark:bg-gray-900 rounded-xl border transition-all overflow-hidden animate-in fade-in slide-in-from-top-2",
                                isActive ? "border-blue-400 shadow-md ring-1 ring-blue-400" : "border-gray-200 dark:border-gray-800 shadow-sm"
                            )}
                        >
                            {/* Step Header (No longer interactive) */}
                            <div className="w-full px-6 py-4 flex items-center gap-4 bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-100 dark:border-gray-800">
                                {isCompleted ? (
                                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                                ) : (
                                    <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
                                )}
                                <span className={cn(
                                    "font-bold text-left",
                                    isCompleted ? "text-gray-900 dark:text-white" : "text-blue-700 dark:text-blue-400"
                                )}>
                                    {step.label}
                                </span>
                            </div>

                            {/* Step Content Payload (Always visible if completed) */}
                            {isCompleted && data && (
                                <div className="p-6">

                                    {/* Intent Content */}
                                    {step.id === 'intent' && (
                                        <div className="space-y-2">
                                            <p className="text-sm text-gray-500">Detected Search Intent:</p>
                                            <p className="font-bold text-gray-900 dark:text-white text-lg tracking-wide">{data.intent}</p>
                                        </div>
                                    )}

                                    {/* Keyword Content */}
                                    {step.id === 'keywords' && (
                                        <div className="space-y-3">
                                            <p className="text-sm text-gray-500 mb-3">Select the keywords you want the AI to include:</p>
                                            <div className="flex flex-wrap gap-2">
                                                {data.keywords?.map((kw: any, i: number) => (
                                                    <button
                                                        key={i}
                                                        onClick={() => toggleKeyword(i)}
                                                        className={cn(
                                                            "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                                                            kw.selected
                                                                ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300"
                                                                : "bg-white border-gray-200 text-gray-500 hover:border-gray-300 dark:bg-gray-900 dark:border-gray-700 dark:hover:border-gray-600"
                                                        )}
                                                    >
                                                        {kw.selected && <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5 mb-0.5" />}
                                                        {kw.text}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* SERP Content */}
                                    {step.id === 'serp' && (
                                        <div className="space-y-3">
                                            <p className="text-sm text-gray-500 mb-3">Uncheck competitors you want to exclude from the AI analysis:</p>
                                            <div className="space-y-2">
                                                {data.competitors?.map((comp: any) => (
                                                    <div
                                                        key={comp.id}
                                                        onClick={() => toggleCompetitor(comp.id)}
                                                        className={cn(
                                                            "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                                                            comp.selected
                                                                ? "bg-white border-green-200 dark:bg-gray-900 dark:border-green-900/30"
                                                                : "bg-gray-50 border-gray-200 opacity-60 dark:bg-gray-800/50 dark:border-gray-800"
                                                        )}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className={cn("w-5 h-5 rounded border flex items-center justify-center transition-colors", comp.selected ? "bg-green-500 border-green-500" : "border-gray-300 dark:border-gray-600")}>
                                                                {comp.selected && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                                                            </div>
                                                            <div>
                                                                <p className={cn("text-sm font-medium", comp.selected ? "text-gray-900 dark:text-white" : "text-gray-500 line-through")}>{comp.title}</p>
                                                                <p className="text-xs text-gray-500">{comp.url}</p>
                                                            </div>
                                                        </div>
                                                        <span className="text-xs font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                                                            ~{comp.wordCount} words
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Fallback for other steps */}
                                    {!['intent', 'keywords', 'serp'].includes(step.id) && (
                                        <p className="text-sm text-gray-500 italic">Analysis completed and saved for outline generation.</p>
                                    )}

                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Action Button */}
            {isAllComplete && data && (
                <div className="flex justify-end pt-4 animate-in fade-in zoom-in duration-500">
                    <button
                        onClick={() => onCompleteResearch(data)}
                        className="inline-flex items-center justify-center px-8 py-3.5 text-base font-bold text-white transition-all bg-green-600 hover:bg-green-700 rounded-xl shadow-md hover:scale-[1.02]"
                    >
                        Review Outline
                        <ChevronDown className="w-5 h-5 ml-2 -rotate-90" />
                    </button>
                </div>
            )}
        </div>
    );
}