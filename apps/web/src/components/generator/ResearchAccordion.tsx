// apps/web/src/components/generator/ResearchAccordion.tsx
"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, ChevronDown, ChevronUp, Search, Target, Link as LinkIcon, HelpCircle, Layers, FileText, RefreshCw } from "lucide-react";
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
    const [expandedPanel, setExpandedPanel] = useState<string | null>(null);
    const [data, setData] = useState<any | null>(null);
    const [activeCompetitors, setActiveCompetitors] = useState<any[]>([]);
    const [standbyCompetitors, setStandbyCompetitors] = useState<any[]>([]);

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
                    // Pre-select all returned competitors
                    const allCompetitors = apiData.competitors.map((c: any) => ({ ...c, selected: true }));

                    // Route the first 10 to active, and the rest (11-15) to standby
                    setActiveCompetitors(allCompetitors.slice(0, 10));
                    setStandbyCompetitors(allCompetitors.slice(10));
                    setData(apiData);
                }
            } catch (err) {
                console.error("[RESEARCH_MOUNT_FAULT]:", err);
                // Graceful degradation fallback
                if (isMounted) {
                    setData({
                        intent: "Informational",
                        keywords: [{ text: "Error fetching data", selected: true }],
                        questions: [],
                        gaps: []
                    });
                    setActiveCompetitors([]);
                }
            }
        };

        performResearch();
        return () => { isMounted = false; };
    }, [config]);

    // UI Simulation Effect synced with API resolution
    useEffect(() => {
        if (activeStepIndex >= researchSteps.length) return;

        // Pause the visual timer at the final step if API data hasn't returned yet
        if (activeStepIndex === researchSteps.length - 1 && !data) return;

        const timer = setTimeout(() => {
            const currentStepId = researchSteps[activeStepIndex].id;
            setCompletedSteps(prev => [...prev, currentStepId]);

            if (['keywords', 'serp', 'questions'].includes(currentStepId)) {
                setExpandedPanel(currentStepId);
            }

            setActiveStepIndex(prev => prev + 1);
        }, 1500);

        return () => clearTimeout(timer);
    }, [activeStepIndex, data]);

    const togglePanel = (stepId: string) => {
        if (!completedSteps.includes(stepId)) return;
        setExpandedPanel(prev => prev === stepId ? null : stepId);
    };

    const toggleKeyword = (index: number) => {
        if (!data) return;
        const newData = { ...data };
        newData.keywords[index].selected = !newData.keywords[index].selected;
        setData(newData);
    };

    /**
     * Handles dynamic competitor deselection.
     * When a user excludes a competitor, it drops out of the active array,
     * and the next available standby competitor is automatically queued in its place
     * to maintain a robust analytical pool of 10 competitors.
     */
    const toggleCompetitor = (id: string) => {
        const compIndex = activeCompetitors.findIndex(c => c.id === id);
        if (compIndex === -1) return;

        const updatedActive = [...activeCompetitors];

        if (updatedActive[compIndex].selected) {
            // Deselecting: Mark as false, and try to pull a replacement from standby
            updatedActive[compIndex].selected = false;

            if (standbyCompetitors.length > 0) {
                const newStandbyList = [...standbyCompetitors];
                const replacement = newStandbyList.shift(); // Pull the top standby

                if (replacement) {
                    replacement.selected = true;
                    // Append the replacement to the active list
                    updatedActive.push(replacement);
                    setStandbyCompetitors(newStandbyList);
                }
            }
        } else {
            // Re-selecting an already excluded one (if they changed their mind)
            updatedActive[compIndex].selected = true;
        }

        setActiveCompetitors(updatedActive);
    };

    const handleFinalize = () => {
        if (!data) return;
        // Construct the final payload ensuring only active, selected competitors are forwarded to the Outline Builder
        const finalizedData: ResearchResultData = {
            ...data,
            competitors: activeCompetitors.filter(c => c.selected)
        };
        onCompleteResearch(finalizedData);
    };

    const isAllComplete = activeStepIndex >= researchSteps.length && data !== null;
    const progressPercentage = (completedSteps.length / researchSteps.length) * 100;

    return (
        <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Header & Progress Status */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            {isAllComplete ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Search className="w-5 h-5 text-blue-600 animate-pulse" />}
                            {isAllComplete ? "Research Phase Complete" : "Executing AI Deep Search..."}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Target objective: <strong className="text-gray-900 dark:text-white">"{config.query || config.topic}"</strong>
                        </p>
                    </div>
                    <div className="text-right">
                        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                            Milestone {Math.min(activeStepIndex + 1, researchSteps.length)} of {researchSteps.length}
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

            {/* Dynamic Accordion Pipeline */}
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

                            {/* Section Context Expansion */}
                            {isExpanded && isCompleted && data && (
                                <div className="px-6 pb-6 pt-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20">

                                    {/* Intent Decoding Matrix */}
                                    {step.id === 'intent' && (
                                        <div className="space-y-2">
                                            <p className="text-sm text-gray-500">Primary Classification Detected:</p>
                                            <p className="font-bold text-gray-900 dark:text-white text-lg tracking-wide">{data.intent}</p>
                                        </div>
                                    )}

                                    {/* LSI & Semantic Keywords */}
                                    {step.id === 'keywords' && (
                                        <div className="space-y-3">
                                            <p className="text-sm text-gray-500 mb-3">Optimize content density by selecting the NLP keywords to inject:</p>
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

                                    {/* SERP Competitor Array with Active Swapping */}
                                    {step.id === 'serp' && (
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center mb-3">
                                                <p className="text-sm text-gray-500">Curate your reference pool. Deselecting a target will swap it for a standby competitor.</p>
                                                <span className="text-xs font-bold text-blue-500 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded flex items-center gap-1">
                                                    <RefreshCw size={12} /> Standby Pool: {standbyCompetitors.length}
                                                </span>
                                            </div>
                                            <div className="space-y-2">
                                                {activeCompetitors.map((comp: any) => (
                                                    <div
                                                        key={comp.id}
                                                        onClick={() => toggleCompetitor(comp.id)}
                                                        className={cn(
                                                            "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                                                            comp.selected
                                                                ? "bg-white border-green-200 dark:bg-gray-900 dark:border-green-900/30"
                                                                : "bg-gray-50 border-gray-200 opacity-50 dark:bg-gray-800/50 dark:border-gray-800"
                                                        )}
                                                    >
                                                        <div className="flex items-center gap-3 truncate pr-4">
                                                            <div className={cn("w-5 h-5 flex-shrink-0 rounded border flex items-center justify-center transition-colors", comp.selected ? "bg-green-500 border-green-500" : "border-gray-300 dark:border-gray-600")}>
                                                                {comp.selected && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                                                            </div>
                                                            <div className="truncate">
                                                                <p className={cn("text-sm font-medium truncate", comp.selected ? "text-gray-900 dark:text-white" : "text-gray-500 line-through")}>{comp.title}</p>
                                                                <p className="text-xs text-gray-500 truncate">{comp.url}</p>
                                                            </div>
                                                        </div>
                                                        <span className="text-xs font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded flex-shrink-0">
                                                            ~{comp.wordCount} words
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Questions & Gaps Previews */}
                                    {step.id === 'questions' && (
                                        <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                                            {data.questions?.map((q: any, i: number) => (
                                                <li key={i}>{q.text}</li>
                                            ))}
                                        </ul>
                                    )}

                                    {step.id === 'gaps' && (
                                        <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                                            {data.gaps?.map((gap: string, i: number) => (
                                                <li key={i}>{gap}</li>
                                            ))}
                                        </ul>
                                    )}

                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Pipeline Action Trigger */}
            {isAllComplete && data && (
                <div className="flex justify-end pt-4 animate-in fade-in zoom-in duration-500">
                    <button
                        onClick={handleFinalize}
                        className="inline-flex items-center justify-center px-8 py-3.5 text-base font-bold text-white transition-all bg-green-600 hover:bg-green-700 rounded-xl shadow-md hover:scale-[1.02]"
                    >
                        Proceed to Outline Architecture
                        <ChevronDown className="w-5 h-5 ml-2 -rotate-90" />
                    </button>
                </div>
            )}
        </div>
    );
}