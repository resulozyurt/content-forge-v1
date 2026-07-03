// apps/web/src/components/generator/LiveGeneration.tsx
"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { CheckCircle2, Code2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { FinalOutlineData, GeneratedBlock } from "@/types/generator";
import DOMPurify from "isomorphic-dompurify";
import { useContentEngine } from "@/hooks/useContentEngine";

interface LiveGenerationProps {
    outlineData: FinalOutlineData & { config?: any };
    onComplete: (
        blocks: GeneratedBlock[],
        seoMeta?: { focusKeyword: string; metaTitle: string; metaDescription: string }
    ) => void;
}

// Allow all semantic HTML tags so inline styles, tables, figures survive DOMPurify
const DOMPURIFY_CONFIG = {
    ALLOWED_TAGS: [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "strong", "em", "b", "i", "u", "s", "br", "hr",
        "ul", "ol", "li",
        "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
        "figure", "figcaption", "img",
        "a", "blockquote", "cite", "pre", "code", "span", "div",
    ],
    ALLOWED_ATTR: [
        "href", "src", "alt", "title", "target", "rel",
        "class", "id", "style",
        "width", "height", "loading",
        "colspan", "rowspan",
        // FIX 4: preserve placeholder attribute so useContentEngine can regex-swap
        // the src after Gemini resolves — without this DOMPurify strips it
        "data-img-placeholder",
    ],
    // Allow data: URIs so Gemini base64 images are not stripped by DOMPurify
    ALLOW_DATA_URI_TAGS: ["img"],
    ADD_URI_SAFE_ATTR: ["src"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORCE_BODY: false,
};

export default function LiveGeneration({ outlineData, onComplete }: LiveGenerationProps) {
    const { status, currentSectionName, generatedContent, seoMetadata, errorMessage, startGeneration } =
        useContentEngine();

    const scrollRef = useRef<HTMLDivElement>(null);
    const logEndRef = useRef<HTMLDivElement>(null);
    // Prevent double-mount invocation in React Strict Mode
    const executionLock = useRef(false);

    // ── Terminal log state ───────────────────────────────────────────────────
    // Each entry: { ts: "HH:MM:SS", text: string, type: 'info'|'success'|'warn'|'section' }
    type LogType = "info" | "success" | "warn" | "section";
    interface LogEntry { ts: string; text: string; type: LogType; }
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const prevStatusRef = useRef<string>("");
    const prevSectionRef = useRef<string>("");
    const sectionCountRef = useRef<number>(0);

    const addLog = (text: string, type: LogType = "info") => {
        const now = new Date();
        const ts = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
        setLogs((prev) => [...prev, { ts, text, type }]);
    };

    // Log when status phase changes
    useEffect(() => {
        if (status === prevStatusRef.current) return;
        prevStatusRef.current = status;

        switch (status) {
            case "RESEARCHING":
                addLog("Initializing research pipeline...", "info");
                addLog("Loading brand guidelines + sitemap context", "info");
                break;
            case "ORCHESTRATING":
                addLog("Research complete. Building narrative blueprint...", "success");
                addLog("Assigning section roles, PAA targets, content gaps", "info");
                break;
            case "WRITING_SECTION":
                // Only log the phase transition once; section name logs below
                if (prevStatusRef.current !== "QA_CHECK") {
                    addLog("Section writing loop started", "info");
                }
                break;
            case "QA_CHECK":
                // logged per-section below
                break;
            case "GENERATING_SEO":
                addLog("All sections complete. Generating Rank Math metadata...", "success");
                break;
            case "COMPLETED":
                addLog("Pipeline complete. Content ready for review.", "success");
                break;
            case "ERROR":
                addLog(`Pipeline halted: ${errorMessage || "unknown error"}`, "warn");
                break;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    // Log each new section name as it starts writing
    useEffect(() => {
        if (!currentSectionName || currentSectionName === prevSectionRef.current) return;
        prevSectionRef.current = currentSectionName;

        if (status === "WRITING_SECTION") {
            sectionCountRef.current += 1;
            addLog(`[${sectionCountRef.current}] Writing: "${currentSectionName}"`, "section");
        } else if (status === "QA_CHECK") {
            addLog(`    └─ QA review: "${currentSectionName}"`, "info");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentSectionName, status]);

    // Log when a new section chunk lands in generatedContent (word count diff)
    const prevWordCountRef = useRef<number>(0);
    useEffect(() => {
        if (!generatedContent) return;
        const words = generatedContent.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
        const diff = words - prevWordCountRef.current;
        if (diff > 50) {
            addLog(`    └─ +${diff} words added (total: ${words})`, "info");
            prevWordCountRef.current = words;
        }
    }, [generatedContent]);

    // Auto-scroll log to bottom
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    // Kick off generation exactly once, passing the user's Outline Architect headings directly
    useEffect(() => {
        if (executionLock.current) return;
        executionLock.current = true;

        // Primary keyword: first selected keyword, then first heading text, then generic fallback
        const keyword =
            outlineData.selectedKeywords?.[0] ||
            outlineData.headings?.[0]?.text ||
            "Target Keyword";

        const selectedKeywords = outlineData.selectedKeywords || [];

        let targetLanguage: "en-US" | "tr-TR" | "es-ES" = "en-US";
        const configLang = (outlineData.config?.language || "").toLowerCase();
        if (configLang === "tr" || configLang.includes("türk")) targetLanguage = "tr-TR";
        if (configLang === "es" || configLang.includes("spanish")) targetLanguage = "es-ES";

        // Pass headings + ResearchAccordion data (questions, gaps) to the engine
        const questions = (outlineData as any).researchData?.questions
            ?.map((q: any) => typeof q === "string" ? q : q.text)
            ?.filter(Boolean) || [];
        const gaps = (outlineData as any).researchData?.gaps || [];

        startGeneration({
            keyword,
            targetLanguage,
            userHeadings: outlineData.headings || [],
            selectedKeywords,
            questions,
            gaps,
            // Faz 5: global image plan (toggle + style) set in the Image step.
            imageConfig: outlineData.imageConfig,
        });

        return () => { executionLock.current = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Notify parent when pipeline finishes, including the generated SEO metadata
    useEffect(() => {
        if (status !== "COMPLETED" || !generatedContent) return;

        const blocks: GeneratedBlock[] = [
            { id: "v2-full-content", type: "html" as any, content: generatedContent },
        ];

        if (seoMetadata) {
            blocks.push({
                id: "v2-seo-metadata",
                type: "seo_metadata",
                content: JSON.stringify(seoMetadata),
            });
        }

        onComplete(blocks, seoMetadata || undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    const isFinished = status === "COMPLETED";

    const progress = useMemo(() => {
        if (errorMessage) return 100;
        const map: Record<string, number> = {
            IDLE: 0,
            RESEARCHING: 15,
            ORCHESTRATING: 35,
            WRITING_SECTION: 60,
            QA_CHECK: 80,
            GENERATING_SEO: 93,
            COMPLETED: 100,
        };
        return map[status] ?? 50;
    }, [status, errorMessage]);

    const taskText = useMemo(() => {
        if (errorMessage) return "Process halted.";
        switch (status) {
            case "IDLE": return "Initializing AI Engine...";
            case "RESEARCHING": return "🔍 Loading brand context and sitemap links...";
            case "ORCHESTRATING": return "🧠 Building narrative blueprint and section plan...";
            case "WRITING_SECTION": return `✍️  Writing: ${currentSectionName || "..."}`;
            case "QA_CHECK": return `🛡️  QA review: ${currentSectionName || "..."}`;
            case "GENERATING_SEO": return "🎯  Generating Rank Math SEO metadata...";
            case "COMPLETED": return "✅  All sections generated successfully.";
            default: return "Processing...";
        }
    }, [status, currentSectionName, errorMessage]);

    const sanitizedHtml = useMemo(
        () => (generatedContent ? DOMPurify.sanitize(generatedContent, DOMPURIFY_CONFIG) : ""),
        [generatedContent]
    );

    return (
        <div className="w-full max-w-5xl mx-auto space-y-4 animate-in fade-in zoom-in-95 duration-500">
            {/* Status header */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <div className={cn(
                            "p-2 rounded-lg",
                            isFinished
                                ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                                : errorMessage
                                    ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                                    : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse"
                        )}>
                            {isFinished ? <CheckCircle2 size={22} /> : <Code2 size={22} />}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                                {isFinished ? "Content Generated Successfully"
                                    : errorMessage ? "Pipeline Failed"
                                        : "Multi-Agent Production Engine Running..."}
                            </h2>
                            <p className={cn(
                                "text-xs font-medium mt-0.5",
                                errorMessage ? "text-red-500"
                                    : isFinished ? "text-green-600 dark:text-green-400"
                                        : "text-blue-600 dark:text-blue-400"
                            )}>
                                {taskText}
                            </p>
                        </div>
                    </div>
                    {isFinished && seoMetadata && (
                        <span className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-lg font-medium">
                            ✓ SEO Metadata Ready
                        </span>
                    )}
                </div>

                {/* Progress bar */}
                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                    <div
                        className={cn(
                            "h-1.5 rounded-full transition-all duration-700",
                            errorMessage ? "bg-red-500" : isFinished ? "bg-green-500" : "bg-blue-500"
                        )}
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>

            {/* ── Terminal log panel ───────────────────────────────────────────── */}
            {(logs.length ?? 0) > 0 && (
                <div className="bg-gray-950 dark:bg-black rounded-xl border border-gray-800 shadow-lg overflow-hidden">
                    {/* Terminal chrome */}
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 border-b border-gray-800">
                        <div className="flex gap-1.5">
                            <span className="w-3 h-3 rounded-full bg-red-500/70" />
                            <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
                            <span className="w-3 h-3 rounded-full bg-green-500/70" />
                        </div>
                        <span className="ml-2 text-xs font-mono text-gray-500 flex items-center gap-1.5">
                            <Terminal size={12} /> contentforge — generation log
                        </span>
                        {!isFinished && (
                            <span className="ml-auto flex items-center gap-1.5 text-xs font-mono text-green-400">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                live
                            </span>
                        )}
                    </div>

                    {/* Log lines */}
                    <div className="px-4 py-3 max-h-[220px] overflow-y-auto font-mono text-xs leading-relaxed space-y-0.5 scroll-smooth">
                        {logs.map((entry, i) => (
                            <div key={i} className="flex items-start gap-3 group">
                                <span className="text-gray-600 shrink-0 select-none pt-px">{entry.ts}</span>
                                <span className={cn(
                                    "flex-1",
                                    entry.type === "success" && "text-green-400",
                                    entry.type === "warn" && "text-red-400",
                                    entry.type === "section" && "text-blue-300 font-semibold",
                                    entry.type === "info" && "text-gray-400",
                                )}>
                                    {entry.type === "success" && <span className="text-green-600 mr-1">✓</span>}
                                    {entry.type === "warn" && <span className="text-red-600 mr-1">✗</span>}
                                    {entry.type === "section" && <span className="text-blue-500 mr-1">›</span>}
                                    {entry.type === "info" && <span className="text-gray-700 mr-1">·</span>}
                                    {entry.text}
                                </span>
                            </div>
                        ))}
                        {/* Blinking cursor while running */}
                        {!isFinished && !errorMessage && (
                            <div className="flex items-center gap-3">
                                <span className="text-gray-600 shrink-0 select-none">
                                    {new Date().toTimeString().slice(0, 8)}
                                </span>
                                <span className="text-gray-500">
                                    · <span className="inline-block w-2 h-3.5 bg-gray-500 animate-pulse ml-0.5 align-middle" />
                                </span>
                            </div>
                        )}
                        <div ref={logEndRef} />
                    </div>
                </div>
            )}

            {/* Live content preview */}
            {sanitizedHtml && (
                <div
                    ref={scrollRef}
                    className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-y-auto max-h-[600px] p-8"
                >
                    <div
                        className={cn(
                            "prose prose-lg dark:prose-invert max-w-none",
                            "prose-h1:text-3xl prose-h1:font-extrabold",
                            "prose-h2:text-2xl prose-h2:font-bold prose-h2:mt-10 prose-h2:mb-4",
                            "prose-h3:text-xl prose-h3:font-semibold prose-h3:mt-6 prose-h3:mb-3",
                            "prose-p:text-gray-600 prose-p:dark:text-gray-300 prose-p:leading-relaxed prose-p:my-3",
                            "prose-ul:my-4 prose-li:my-1",
                            "prose-table:w-full prose-table:border-collapse prose-th:border prose-th:px-4 prose-th:py-2 prose-th:bg-gray-100 prose-th:dark:bg-gray-800 prose-td:border prose-td:px-4 prose-td:py-2",
                            "prose-a:text-blue-600 prose-a:hover:underline",
                            "prose-blockquote:border-l-4 prose-blockquote:border-indigo-500 prose-blockquote:bg-indigo-50 prose-blockquote:dark:bg-indigo-900/20 prose-blockquote:px-6 prose-blockquote:py-4 prose-blockquote:rounded-r-xl",
                            "prose-figure:my-8 prose-img:rounded-xl prose-img:shadow-lg prose-img:w-full",
                            "prose-figcaption:text-center prose-figcaption:text-sm prose-figcaption:text-gray-500 prose-figcaption:italic"
                        )}
                        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                    />
                    {(status === "WRITING_SECTION" || status === "QA_CHECK") && (
                        <div className="w-3 h-6 bg-blue-500 animate-pulse mt-4 rounded" />
                    )}
                </div>
            )}
        </div>
    );
}