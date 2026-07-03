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

// Each step carries a plain-English description shown under its heading once
// the step is complete, so the user understands what they are looking at and
// what they can do with it (select / deselect, etc.).
const RESEARCH_STEPS = [
    {
        id: "intent",
        label: "Decoding Search Intent",
        icon: Target,
        description:
            "This is what people are really after when they search this term — learning, comparing, or ready to buy. We aim the whole article at matching it.",
    },
    {
        id: "keywords",
        label: "Expanding Keywords",
        icon: Search,
        description:
            "These are the related terms we'll work into your article so it ranks for more than just your main keyword. Tap any term to add or drop it — only the highlighted ones get used.",
    },
    {
        id: "serp",
        label: "Top-Ranking Content",
        icon: LinkIcon,
        description:
            "These are the pages already winning the top spots for this search. We study them so yours can do better. Keep the ones worth referencing and drop the rest.",
    },
    {
        id: "questions",
        label: "Questions People Ask",
        icon: HelpCircle,
        description:
            "These are the real questions people ask around this topic. Covering them helps you show up in Google's \"People Also Ask\" box.",
    },
    {
        id: "gaps",
        label: "Finding Gaps",
        icon: Layers,
        description:
            "These are angles the top pages barely touch — your chance to say something they didn't. Pick the one or two you want your article to own.",
    },
    {
        id: "outline",
        label: "Building Outline",
        icon: FileText,
    },
];

const STEP_INTERVAL_MS = 1400; // Time between visual step advances
const MAX_GAPS = 2; // A focused article should own only 1–2 gaps, not all of them

export default function ResearchAccordion({ config, onCompleteResearch }: ResearchAccordionProps) {
    const [activeStepIndex, setActiveStepIndex] = useState(0);
    const [completedSteps, setCompletedSteps] = useState<string[]>([]);
    const [data, setData] = useState<ResearchResultData | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Selected content-gap indices (kept separate so `data.gaps` stays string[]).
    const [selectedGaps, setSelectedGaps] = useState<number[]>([]);

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
                // Pre-select up to the first MAX_GAPS gaps so the pipeline always
                // has a focused default even if the user doesn't interact.
                setSelectedGaps((apiData.gaps ?? []).slice(0, MAX_GAPS).map((_: string, i: number) => i));
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
                setSelectedGaps([]);
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

    // ── PHASE 3: Manual proceed — user reviews results then clicks the button ───
    const handleProceed = () => {
        if (!data || completedFired.current) return;
        completedFired.current = true;

        // Emit only the gaps the user chose, still as a plain string[] so the
        // downstream orchestrate route contract is unchanged.
        const chosenGaps = (data.gaps ?? []).filter((_: string, i: number) => selectedGaps.includes(i));
        onCompleteResearch({ ...data, gaps: chosenGaps });
    };

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

    // Toggle a content gap, enforcing the MAX_GAPS cap (ignore clicks past it).
    const toggleGap = (index: number) => {
        setSelectedGaps((prev) => {
            if (prev.includes(index)) return prev.filter((i) => i !== index);
            if (prev.length >= MAX_GAPS) return prev;
            return [...prev, index];
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
                                    {/* Plain-English explainer for this section */}
                                    {step.description && (
                                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
                                            {step.description}
                                        </p>
                                    )}

                                    {step.id === "intent" && (
                                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                            {data.intent}
                                        </span>
                                    )}

                                    {step.id === "keywords" && (data.keywords?.length ?? 0) > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {(data.keywords ?? []).slice(0, 18).map((kw: any, i: number) => (
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

                                    {step.id === "serp" && (data.competitors?.length ?? 0) > 0 && (
                                        <div className="space-y-2">
                                            {(data.competitors ?? []).slice(0, 5).map((comp: any) => (
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

                                    {step.id === "questions" && (data.questions?.length ?? 0) > 0 && (
                                        <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 dark:text-gray-300">
                                            {(data.questions ?? []).slice(0, 8).map((q: any, i: number) => (
                                                <li key={i}>{q.text}</li>
                                            ))}
                                        </ul>
                                    )}

                                    {step.id === "gaps" && (data.gaps?.length ?? 0) > 0 && (
                                        <div className="space-y-3">
                                            <div className="flex flex-wrap gap-2">
                                                {(data.gaps ?? []).map((gap: string, i: number) => {
                                                    const isSelected = selectedGaps.includes(i);
                                                    const capReached = (selectedGaps.length ?? 0) >= MAX_GAPS;
                                                    return (
                                                        <button
                                                            key={i}
                                                            onClick={() => toggleGap(i)}
                                                            disabled={!isSelected && capReached}
                                                            className={cn(
                                                                "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                                                                isSelected
                                                                    ? "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-700"
                                                                    : capReached
                                                                        ? "bg-gray-50 text-gray-400 border-gray-200 opacity-60 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700"
                                                                        : "bg-white text-purple-700 border-purple-200 hover:bg-purple-50 dark:bg-gray-900 dark:text-purple-300 dark:border-purple-800 dark:hover:bg-purple-900/20"
                                                            )}
                                                        >
                                                            {gap}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                                Pick up to {MAX_GAPS} to focus your article ({selectedGaps.length}/{MAX_GAPS} selected).
                                            </p>
                                        </div>
                                    )}

                                    {step.id === "outline" && (
                                        <p className="text-sm text-gray-500 dark:text-gray-400 italic flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                                            Research data consolidated. Review your selections above, then proceed.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Proceed button — visible only when all steps done and data ready */}
            {isAllComplete && data && (
                <div className="flex justify-end pt-2 animate-in fade-in zoom-in duration-500">
                    <button
                        onClick={handleProceed}
                        className="inline-flex items-center justify-center gap-2 px-8 py-3.5 text-base font-bold text-white bg-green-600 hover:bg-green-700 rounded-xl shadow-md hover:scale-[1.02] transition-all"
                    >
                        Review Outline Matrix
                        <ChevronDown className="w-5 h-5 -rotate-90" />
                    </button>
                </div>
            )}
        </div>
    );
}