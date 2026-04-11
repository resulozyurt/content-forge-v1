// apps/web/src/components/generator/ResearchAccordion.tsx
"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, ChevronDown, ChevronUp, Search, Target, Link as LinkIcon, HelpCircle, Layers, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { GeneratorConfigData, ResearchResultData } from "@/types/generator";

interface ResearchAccordionProps {
    config: GeneratorConfigData;
    onCompleteResearch: (data: ResearchResultData) => void;
}

// Simülasyon Adımları
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
    const [expandedPanel, setExpandedPanel] = useState<string | null>(null);

    // Örnek simülasyon verisi (Milestone 8'de bu veri API'den gerçek gelecek)
    const [mockData, setMockData] = useState<ResearchResultData>({
        intent: "Informational & Commercial Investigation",
        keywords: [
            { text: "best " + config.query, selected: true },
            { text: config.query + " alternatives", selected: true },
            { text: "how to use " + config.query, selected: true },
            { text: "free " + config.query, selected: false }, // Kullanıcı bunu eleyebilir
        ],
        competitors: [
            { id: '1', url: "competitor1.com/guide", title: "The Ultimate Guide to " + config.query, wordCount: 2450, selected: true },
            { id: '2', url: "competitor2.com/review", title: config.query + " Review 2026", wordCount: 1800, selected: true },
            { id: '3', url: "irrelevant-site.com/spam", title: "Cheap " + config.query, wordCount: 500, selected: false }, // Kullanıcının elediği rakip
        ],
        questions: [
            { text: "What is the best " + config.query + "?", selected: true },
            { text: "How much does " + config.query + " cost?", selected: true },
        ]
    });

    // Simülasyon Efekti: Adımları sırayla doldurur
    useEffect(() => {
        if (activeStepIndex >= researchSteps.length) return;

        const timer = setTimeout(() => {
            const currentStepId = researchSteps[activeStepIndex].id;
            setCompletedSteps(prev => [...prev, currentStepId]);

            // Tamamlanan adımı otomatik aç (isteğe bağlı, Frase hissi için)
            if (['keywords', 'serp', 'questions'].includes(currentStepId)) {
                setExpandedPanel(currentStepId);
            }

            setActiveStepIndex(prev => prev + 1);
        }, 1500); // Her adım 1.5 saniye sürer

        return () => clearTimeout(timer);
    }, [activeStepIndex]);

    const togglePanel = (stepId: string) => {
        if (!completedSteps.includes(stepId)) return; // Sadece tamamlanmışlar açılabilir
        setExpandedPanel(prev => prev === stepId ? null : stepId);
    };

    const toggleKeyword = (index: number) => {
        const newData = { ...mockData };
        newData.keywords[index].selected = !newData.keywords[index].selected;
        setMockData(newData);
    };

    const toggleCompetitor = (id: string) => {
        const newData = { ...mockData };
        const compIndex = newData.competitors.findIndex(c => c.id === id);
        if (compIndex > -1) {
            newData.competitors[compIndex].selected = !newData.competitors[compIndex].selected;
            setMockData(newData);
        }
    };

    const isAllComplete = activeStepIndex >= researchSteps.length;
    const progressPercentage = (completedSteps.length / researchSteps.length) * 100;

    return (
        <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Header & Progress */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Search className="w-5 h-5 text-blue-600" />
                            Researching...
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Target query: <strong className="text-gray-900 dark:text-white">"{config.query}"</strong>
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

            {/* Accordion List */}
            <div className="space-y-3">
                {researchSteps.map((step, index) => {
                    const isCompleted = completedSteps.includes(step.id);
                    const isActive = index === activeStepIndex;
                    const isExpanded = expandedPanel === step.id;

                    return (
                        <div
                            key={step.id}
                            className={cn(
                                "bg-white dark:bg-gray-900 rounded-xl border transition-all overflow-hidden",
                                isActive ? "border-blue-400 shadow-md ring-1 ring-blue-400" :
                                    isCompleted ? "border-gray-200 dark:border-gray-800" : "border-gray-100 dark:border-gray-800/50 opacity-60"
                            )}
                        >
                            {/* Accordion Header */}
                            <button
                                onClick={() => togglePanel(step.id)}
                                disabled={!isCompleted}
                                className="w-full px-6 py-4 flex items-center justify-between bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer disabled:cursor-default"
                            >
                                <div className="flex items-center gap-4">
                                    {isCompleted ? (
                                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                                    ) : isActive ? (
                                        <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                                    ) : (
                                        <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-700" />
                                    )}
                                    <span className={cn(
                                        "font-medium text-left",
                                        isCompleted ? "text-gray-900 dark:text-white" :
                                            isActive ? "text-blue-700 dark:text-blue-400 font-bold" : "text-gray-400 dark:text-gray-600"
                                    )}>
                                        {step.label}
                                    </span>
                                </div>

                                {isCompleted && (
                                    isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />
                                )}
                            </button>

                            {/* Accordion Content (Interactivity) */}
                            {isExpanded && isCompleted && (
                                <div className="px-6 pb-6 pt-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20">

                                    {/* Keyword Selection Content */}
                                    {step.id === 'keywords' && (
                                        <div className="space-y-3">
                                            <p className="text-sm text-gray-500 mb-3">Select the keywords you want the AI to include:</p>
                                            <div className="flex flex-wrap gap-2">
                                                {mockData.keywords.map((kw, i) => (
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

                                    {/* SERP Competitor Selection Content */}
                                    {step.id === 'serp' && (
                                        <div className="space-y-3">
                                            <p className="text-sm text-gray-500 mb-3">Uncheck competitors you want to exclude from the AI analysis:</p>
                                            <div className="space-y-2">
                                                {mockData.competitors.map((comp) => (
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
                                                            {comp.wordCount} words
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Fallback for other steps */}
                                    {!['keywords', 'serp'].includes(step.id) && (
                                        <p className="text-sm text-gray-500 italic">Analysis completed and saved for outline generation.</p>
                                    )}

                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Action Button */}
            {isAllComplete && (
                <div className="flex justify-end pt-4 animate-in fade-in zoom-in duration-500">
                    <button
                        onClick={() => onCompleteResearch(mockData)}
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