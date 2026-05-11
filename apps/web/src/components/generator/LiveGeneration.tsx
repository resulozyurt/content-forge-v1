// apps/web/src/components/generator/LiveGeneration.tsx
"use client";

import { useEffect, useRef, useMemo } from "react";
import { Loader2, CheckCircle2, Sparkles, Code2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FinalOutlineData, GeneratedBlock } from "@/types/generator";
import DOMPurify from "isomorphic-dompurify";
import { useContentEngine } from "@/hooks/useContentEngine";

interface LiveGenerationProps {
    outlineData: FinalOutlineData & { config?: any };
    onComplete: (blocks: GeneratedBlock[]) => void;
}

// ---------------------------------------------------------------------------
// DOMPurify — tablo, figür, resim, liste gibi tüm HTML taglarını koru
// ---------------------------------------------------------------------------
const DOMPURIFY_CONFIG: DOMPurify.Config = {
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
    ],
    // Harici görsellere izin ver (placehold.co, Gemini API URL'leri vb.)
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORCE_BODY: false,
};

export default function LiveGeneration({ outlineData, onComplete }: LiveGenerationProps) {
    const { status, currentSectionName, generatedContent, errorMessage, startGeneration } =
        useContentEngine();

    const scrollRef = useRef<HTMLDivElement>(null);
    const executionLock = useRef(false);

    // İçerik güncellenince otomatik scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [generatedContent, status]);

    // Pipeline'ı başlat
    useEffect(() => {
        if (executionLock.current) return;
        executionLock.current = true;

        const keyword =
            outlineData.selectedKeywords?.[0] || outlineData.headings?.[0]?.text || "Target Keyword";

        let targetLanguage: "en-US" | "tr-TR" | "es-ES" = "en-US";
        const configLang = outlineData.config?.language?.toLowerCase() || "";
        if (configLang.includes("türk") || configLang.includes("tr")) targetLanguage = "tr-TR";
        if (configLang.includes("spanish") || configLang.includes("es")) targetLanguage = "es-ES";

        startGeneration({ keyword, targetLanguage });

        return () => {
            executionLock.current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isFinished = status === "COMPLETED";

    const progress = useMemo(() => {
        if (errorMessage) return 100;
        switch (status) {
            case "IDLE": return 0;
            case "RESEARCHING": return 20;
            case "PLANNING": return 40;
            case "WRITING_SECTION": return 65;
            case "QA_CHECK": return 85;
            case "COMPLETED": return 100;
            default: return 50;
        }
    }, [status, errorMessage]);

    const currentTaskText = useMemo(() => {
        if (errorMessage) return "Process halted.";
        switch (status) {
            case "IDLE": return "Initializing AI Engine...";
            case "RESEARCHING": return "🔍 Analyzing SERP data & brand guidelines...";
            case "PLANNING": return "📐 Architecting JSON-based section blueprints...";
            case "WRITING_SECTION": return `✍️ Drafting section: ${currentSectionName || "..."}`;
            case "QA_CHECK": return `🛡️ Running strict format & readability checks on: ${currentSectionName || "..."}`;
            case "COMPLETED": return "Generation Complete!";
            default: return "Processing...";
        }
    }, [status, currentSectionName, errorMessage]);

    // ---------------------------------------------------------------------------
    // generatedContent artık saf HTML string'i — bunu ProseEditor'a tek blok
    // olarak geçiriyoruz. Ara aşamada render için sanitize ediyoruz.
    // ---------------------------------------------------------------------------
    const sanitizedHtml = useMemo(() => {
        if (!generatedContent) return "";
        return DOMPurify.sanitize(generatedContent, DOMPURIFY_CONFIG);
    }, [generatedContent]);

    // ProseEditor geriye dönük uyumluluk: tek bir "html" bloğu oluştur
    const blocks = useMemo<GeneratedBlock[]>(() => {
        if (!generatedContent) return [];
        return [
            {
                id: "v2-full-content",
                type: "html" as any,
                content: generatedContent, // sanitize ProseEditor içinde yapılacak
            },
        ];
    }, [generatedContent]);

    return (
        <div className="w-full max-w-5xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-500">
            {/* Header Dashboard */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div
                            className={cn(
                                "p-2 rounded-lg",
                                isFinished
                                    ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                                    : errorMessage
                                        ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                                        : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse"
                            )}
                        >
                            {isFinished ? <CheckCircle2 size={24} /> : <Code2 size={24} />}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                {isFinished
                                    ? "Content Successfully Generated"
                                    : errorMessage
                                        ? "Pipeline Execution Failed"
                                        : "Multi-Agent Production Engine Running..."}
                            </h2>
                            <p
                                className={cn(
                                    "text-sm font-medium mt-0.5 flex items-center gap-2",
                                    errorMessage ? "text-red-500" : "text-gray-500 dark:text-gray-400"
                                )}
                            >
                                {!isFinished && !errorMessage && <Loader2 size={14} className="animate-spin" />}
                                {errorMessage ? errorMessage : currentTaskText}
                            </p>
                        </div>
                    </div>

                    {isFinished && (
                        <button
                            onClick={() => onComplete(blocks)}
                            className="inline-flex items-center px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-lg shadow-md hover:from-blue-700 hover:to-indigo-700 transition-all hover:scale-105"
                        >
                            Open in Editor
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </button>
                    )}
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                        className={cn(
                            "h-2 rounded-full transition-all duration-500 ease-out",
                            errorMessage
                                ? "bg-red-500"
                                : "bg-gradient-to-r from-blue-600 to-indigo-600"
                        )}
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>

            {/* Content Output Viewport — HTML direkt render edilir */}
            <div
                ref={scrollRef}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-inner overflow-y-auto p-8 h-[600px] scroll-smooth"
            >
                <div className="max-w-3xl mx-auto">
                    {!sanitizedHtml && !errorMessage && (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4 opacity-50 pt-20">
                            <Sparkles size={48} className="animate-pulse" />
                            <p>Connecting to AI microservices...</p>
                        </div>
                    )}

                    {sanitizedHtml && (
                        <div
                            className={cn(
                                // Temel yazı stili
                                "prose prose-lg dark:prose-invert max-w-none",
                                // H2 stilleri
                                "prose-h2:text-2xl prose-h2:font-bold prose-h2:text-gray-900 prose-h2:dark:text-white prose-h2:mt-10 prose-h2:mb-4",
                                // H3 stilleri
                                "prose-h3:text-xl prose-h3:font-semibold prose-h3:text-gray-800 prose-h3:dark:text-gray-200 prose-h3:mt-6 prose-h3:mb-3",
                                // Paragraf stilleri
                                "prose-p:text-gray-600 prose-p:dark:text-gray-300 prose-p:leading-relaxed prose-p:my-3",
                                // Liste stilleri
                                "prose-ul:my-4 prose-li:my-1",
                                // Tablo stilleri
                                "prose-table:w-full prose-table:border-collapse prose-th:border prose-th:border-gray-300 prose-th:px-4 prose-th:py-2 prose-th:bg-gray-100 prose-th:dark:bg-gray-800 prose-td:border prose-td:border-gray-300 prose-td:px-4 prose-td:py-2",
                                // Link stilleri
                                "prose-a:text-blue-600 prose-a:hover:underline",
                                // Blockquote stilleri
                                "prose-blockquote:border-l-4 prose-blockquote:border-indigo-500 prose-blockquote:bg-indigo-50 prose-blockquote:dark:bg-indigo-900/20 prose-blockquote:px-6 prose-blockquote:py-4 prose-blockquote:rounded-r-xl prose-blockquote:not-italic",
                                // Figure/img stilleri
                                "prose-figure:my-8 prose-img:rounded-2xl prose-img:shadow-lg prose-img:w-full",
                                // Figcaption
                                "prose-figcaption:text-center prose-figcaption:text-sm prose-figcaption:text-gray-500 prose-figcaption:italic"
                            )}
                            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                        />
                    )}

                    {status === "WRITING_SECTION" && sanitizedHtml && (
                        <div className="w-3 h-6 bg-blue-500 animate-pulse mt-4 rounded" />
                    )}
                </div>
            </div>
        </div>
    );
}
