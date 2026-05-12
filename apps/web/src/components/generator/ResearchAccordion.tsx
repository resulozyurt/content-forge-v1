// apps/web/src/components/generator/ResearchAccordion.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import {
    Loader2, CheckCircle2, Search, Target, Link as LinkIcon,
    HelpCircle, Layers, FileText, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GeneratorConfigData, ResearchResultData } from "@/types/generator";

interface ResearchAccordionProps {
    config: GeneratorConfigData;
    onCompleteResearch: (data: ResearchResultData) => void;
}

const RESEARCH_STEPS = [
    { id: "intent", label: "Decoding Search Intent", icon: Target },
    { id: "keywords", label: "Expanding Keywords", icon: Search },
    { id: "serp", label: "Analyzing SERP", icon: LinkIcon },
    { id: "questions", label: "Finding Questions", icon: HelpCircle },
    { id: "gaps", label: "Finding Gaps", icon: Layers },
    { id: "outline", label: "Building Outline", icon: FileText },
];

const STEP_INTERVAL_MS = 1400; // Time between visual step advances

export default function ResearchAccordion({ config, onCompleteResearch }: ResearchAccordionProps) {
    const [activeStepIndex, setActiveStepIndex] = useState(0);
    const [completedSteps, setCompletedSteps] = useState<string[]>([]);
    const [data, setData] = useState<ResearchResultData | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Prevent double-fire in React Strict Mode and re-renders
    const fetchLock = useRef(false);
    // Track whether onCompleteResearch has already been called
    const completedFired = useRef(false);

    const stableQuery = config.query || (config as any).topic || "Default Topic";

    // ── PHASE 1: Fetch research data ─────────────────────────────────────────
    useEffect(() => {
        if (fetchLock.current) return;
        fetchLock.current = true;

        let isMounted = true;

        const run = async () => {
            try {
                const res = await fetch("/api/research", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ topic: stableQuery, config }),
                });

                if (!res.ok) throw new Error(`Research API returned ${res.status}`);

                const json = await res.json();
                const apiData: ResearchResultData = json.data;

                if (!isMounted) return;

                // Ensure every competitor and keyword has a `selected` flag
                if (apiData.competitors) {
                    apiData.competitors = apiData.competitors.map((c: any) => ({
                        ...c,
                        selected: c.selected ?? true,
                    }));
                }
                if (apiData.keywords) {
                    apiData.keywords = apiData.keywords.map((k: any) => ({
                        ...k,
                        selected: k.selected ?? true,
                    }));
                }

                setData(apiData);
            } catch (err: any) {
                if (!isMounted) return;
                console.error("[RESEARCH_ACCORDION_ERROR]", err);
                setError(err.message || "Research failed. Please try again.");
                // Provide a minimal fallback so the pipeline can continue
                setData({
                    intent: "Informational",
                    keywords: [{ text: stableQuery, selected: true }],
                    competitors: [],
                    questions: [],
                    gaps: [],
                } as any);
            }
        };

        run();
        return () => { isMounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── PHASE 2: Visual step progression ────────────────────────────────────
    // Advances one step every STEP_INTERVAL_MS.
    // Holds at the last step ("Building Outline") until `data` is ready,
    // then advances through it — resolving the race condition.
    useEffect(() => {
        if (activeStepIndex >= RESEARCH_STEPS.length) return;

        const isLastStep = activeStepIndex === RESEARCH_STEPS.length - 1;

        // Don't advance past the last visual step until API data has arrived
        if (isLastStep && !data) return;

        const timer = setTimeout(() => {
            setCompletedSteps((prev) => [...prev, RESEARCH_STEPS[activeStepIndex].id]);
            setActiveStepIndex((prev) => prev + 1);
        }, STEP_INTERVAL_MS);

        return () => clearTimeout(timer);
    }, [activeStepIndex, data]);

    // ── PHASE 3: Auto-proceed once all steps complete and data is ready ──────
    // No manual button click needed — fires onCompleteResearch automatically.
    useEffect(() => {
        const allDone = activeStepIndex >= RESEARCH_STEPS.length;
        if (!allDone || !data || completedFired.current) return;

        completedFired.current = true;

        // Small delay so the user can see the final "completed" state before transitioning
        const timer = setTimeout(() => {
            onCompleteResearch(data);
        }, 600);

        return () => clearTimeout(timer);
    }, [activeStepIndex, data, onCompleteResearch]);

    // ── Keyword / Competitor toggles ─────────────────────────────────────────
    const toggleKeyword = (index: number) => {
        if (!data) return;
        setData((prev) => {
            if (!prev) return prev;
            const keywords = [...prev.keywords];
            keywords[index] = { ...keywords[index], selected: !keywords[index].selected };
            return { ...prev, keywords };
        });
    };

    const toggleCompetitor = (id: string) => {
        if (!data) return;
        setData((prev) => {
            if (!prev) return prev;
            const competitors = prev.competitors.map((c: any) =>
                c.id === id ? { ...c, selected: !c.selected } : c
            );
            return { ...prev, competitors };
        });
    };

    const isAllComplete = activeStepIndex >= RESEARCH_STEPS.length && data !== null;
    const progressPercentage = Math.round((completedSteps.length / RESEARCH_STEPS.length) * 100);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Header */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            {isAllComplete
                                ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                                : <Search className="w-5 h-5 text-blue-600 animate-pulse" />}
                            {isAllComplete ? "Research Complete" : "Researching..."}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Target query: <strong className="text-gray-900 dark:text-white">"{stableQuery}"</strong>
                        </p>
                    </div>
                    <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                        Step {Math.min(activeStepIndex + 1, RESEARCH_STEPS.length)} of {RESEARCH_STEPS.length}
                    </span>
                </div>

                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                    <div
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 h-2.5 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${progressPercentage}%` }}
                    />
                </div>

                {error && (
                    <p className="mt-3 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                        ⚠️ {error} — continuing with available data.
                    </p>
                )}
            </div>

            {/* Step cards */}
            <div className="space-y-4">
                {RESEARCH_STEPS.map((step, index) => {
                    const isCompleted = completedSteps.includes(step.id);
                    const isActive = index === activeStepIndex;
                    if (!isCompleted && !isActive) return null;

                    const Icon = step.icon;

                    return (
                        <div
                            key={step.id}
                            className={cn(
                                "bg-white dark:bg-gray-900 rounded-xl border transition-all overflow-hidden animate-in fade-in slide-in-from-top-2",
                                isActive
                                    ? "border-blue-400 shadow-md ring-1 ring-blue-400"
                                    : "border-gray-200 dark:border-gray-800 shadow-sm"
                            )}
                        >
                            {/* Step header */}
                            <div className="w-full px-6 py-4 flex items-center gap-4 bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-100 dark:border-gray-800">
                                {isCompleted
                                    ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                                    : <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />}
                                <span className={cn(
                                    "font-bold text-left",
                                    isCompleted
                                        ? "text-gray-900 dark:text-white"
                                        : "text-blue-600 dark:text-blue-400"
                                )}>
                                    {step.label}
                                </span>
                            </div>

                            {/* Step content — only show for completed steps with data */}
                            {isCompleted && data && (
                                <div className="px-6 py-4">
                                    {step.id === "intent" && (
                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                            {data.intent}
                                        </span>
                                    )}

                                    {step.id === "keywords" && data.keywords?.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {data.keywords.slice(0, 18).map((kw: any, i: number) => (
                                                <button
                                                    key={i}
                                                    onClick={() => toggleKeyword(i)}
                                                    className={cn(
                                                        "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                                                        kw.selected
                                                            ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800"
                                                            : "bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"
                                                    )}
                                                >
                                                    {kw.text}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {step.id === "serp" && data.competitors?.length > 0 && (
                                        <div className="space-y-2">
                                            {data.competitors.slice(0, 5).map((comp: any) => (
                                                <button
                                                    key={comp.id}
                                                    onClick={() => toggleCompetitor(comp.id)}
                                                    className={cn(
                                                        "w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors",
                                                        comp.selected
                                                            ? "bg-indigo-50 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-800"
                                                            : "bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700"
                                                    )}
                                                >
                                                    <div className={cn(
                                                        "w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors",
                                                        comp.selected
                                                            ? "bg-indigo-500 border-indigo-500"
                                                            : "border-gray-300 dark:border-gray-600"
                                                    )} />
                                                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                                                        {comp.title}
                                                    </span>
                                                    <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
                                                        {comp.wordCount?.toLocaleString()} words
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {step.id === "questions" && data.questions?.length > 0 && (
                                        <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 dark:text-gray-300">
                                            {data.questions.slice(0, 8).map((q: any, i: number) => (
                                                <li key={i}>{q.text}</li>
                                            ))}
                                        </ul>
                                    )}

                                    {step.id === "gaps" && data.gaps?.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {data.gaps.map((gap: string, i: number) => (
                                                <span
                                                    key={i}
                                                    className="px-3 py-1.5 rounded-md bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 text-sm font-medium border border-purple-200 dark:border-purple-800"
                                                >
                                                    {gap}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {step.id === "outline" && (
                                        <p className="text-sm text-gray-500 dark:text-gray-400 italic flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                                            Data consolidated — transitioning to Outline Architect...
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}