// apps/web/src/components/generator/LiveGeneration.tsx
"use client";

import { useEffect, useRef, useMemo } from "react";
import { CheckCircle2, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FinalOutlineData, GeneratedBlock } from "@/types/generator";
import DOMPurify from "isomorphic-dompurify";
import { useContentEngine } from "@/hooks/useContentEngine";

interface LiveGenerationProps {
    outlineData: FinalOutlineData & { config?: any };
    onComplete: (blocks: GeneratedBlock[], seoMeta?: { focusKeyword: string; metaTitle: string; metaDescription: string }) => void;
}

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
    ],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORCE_BODY: false,
};

export default function LiveGeneration({ outlineData, onComplete }: LiveGenerationProps) {
    const { status, currentSectionName, generatedContent, seoMetadata, errorMessage, startGeneration } =
        useContentEngine();

    const scrollRef = useRef<HTMLDivElement>(null);
    const executionLock = useRef(false);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [generatedContent]);

    // Start pipeline once on mount
    useEffect(() => {
        if (executionLock.current) return;
        executionLock.current = true;

        const keyword =
            outlineData.selectedKeywords?.[0] ||
            outlineData.headings?.[0]?.text ||
            "Target Keyword";

        // All selected keywords — used for density optimization + SEO score
        const selectedKeywords = outlineData.selectedKeywords || [];

        // All heading texts for context
        const allHeadings = outlineData.headings?.map((h) => h.text) || [];

        let targetLanguage: "en-US" | "tr-TR" | "es-ES" = "en-US";
        const configLang = outlineData.config?.language?.toLowerCase() || "";
        if (configLang.includes("türk") || configLang === "tr") targetLanguage = "tr-TR";
        if (configLang.includes("spanish") || configLang === "es") targetLanguage = "es-ES";

        startGeneration({ keyword, targetLanguage, selectedKeywords, allHeadings });

        return () => { executionLock.current = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fire onComplete when generation finishes — pass seoMetadata alongside blocks
    useEffect(() => {
        if (status === "COMPLETED" && generatedContent) {
            const blocks: GeneratedBlock[] = [
                { id: "v2-full-content", type: "html" as any, content: generatedContent },
            ];
            // Append SEO metadata as a block so ProseEditor picks it up
            if (seoMetadata) {
                blocks.push({
                    id: "v2-seo-metadata",
                    type: "seo_metadata",
                    content: JSON.stringify(seoMetadata),
                });
            }
            onComplete(blocks, seoMetadata || undefined);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    const isFinished = status === "COMPLETED";

    const progress = useMemo(() => {
        if (errorMessage) return 100;
        switch (status) {
            case "IDLE": return 0;
            case "RESEARCHING": return 15;
            case "PLANNING": return 35;
            case "WRITING_SECTION": return 60;
            case "QA_CHECK": return 80;
            case "GENERATING_SEO": return 93;
            case "COMPLETED": return 100;
            default: return 50;
        }
    }, [status, errorMessage]);

    const currentTaskText = useMemo(() => {
        if (errorMessage) return "Process halted.";
        switch (status) {
            case "IDLE": return "Initializing AI Engine...";
            case "RESEARCHING": return "🔍 Analyzing SERP data & brand guidelines...";
            case "PLANNING": return "📐 Architecting section blueprints...";
            case "WRITING_SECTION": return `✍️ Drafting: ${currentSectionName || "..."}`;
            case "QA_CHECK": return `🛡️ QA check: ${currentSectionName || "..."}`;
            case "GENERATING_SEO": return "🎯 Generating Rank Math SEO metadata...";
            case "COMPLETED": return "✅ Generation Complete!";
            default: return "Processing...";
        }
    }, [status, currentSectionName, errorMessage]);

    const sanitizedHtml = useMemo(() => {
        if (!generatedContent) return "";
        return DOMPurify.sanitize(generatedContent, DOMPURIFY_CONFIG);
    }, [generatedContent]);

    return (
        <div className="w-full max-w-5xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-500">
            {/* Header */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={cn(
                            "p-2 rounded-lg",
                            isFinished ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                                : errorMessage ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                                    : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse"
                        )}>
                            {isFinished ? <CheckCircle2 size={24} /> : <Code2 size={24} />}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                {isFinished ? "Content Generated Successfully"
                                    : errorMessage ? "Pipeline Failed"
                                        : "Multi-Agent Production Engine Running..."}
                            </h2>
                            <p className={cn(
                                "text-sm font-medium mt-0.5",
                                errorMessage ? "text-red-500" : isFinished ? "text-green-600 dark:text-green-400" : "text-blue-600 dark:text-blue-400"
                            )}>
                                {currentTaskText}
                            </p>
                        </div>
                    </div>
                    {isFinished && seoMetadata && (
                        <div className="text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-lg font-medium">
                            ✓ SEO Metadata Ready
                        </div>
                    )}
                </div>

                {/* Progress bar */}
                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                        className={cn(
                            "h-2 rounded-full transition-all duration-700",
                            errorMessage ? "bg-red-500" : isFinished ? "bg-green-500" : "bg-blue-500"
                        )}
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>

            {/* Live content preview */}
            {sanitizedHtml && (
                <div
                    ref={scrollRef}
                    className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-y-auto max-h-[600px] p-8"
                >
                    <div
                        className={cn(
                            "prose prose-lg dark:prose-invert max-w-none",
                            "prose-h1:text-3xl prose-h1:font-extrabold prose-h1:text-gray-900",
                            "prose-h2:text-2xl prose-h2:font-bold prose-h2:text-gray-900 prose-h2:mt-10 prose-h2:mb-4",
                            "prose-h3:text-xl prose-h3:font-semibold prose-h3:text-gray-800 prose-h3:mt-6 prose-h3:mb-3",
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
                    {status === "WRITING_SECTION" && (
                        <div className="w-3 h-6 bg-blue-500 animate-pulse mt-4 rounded" />
                    )}
                </div>
            )}
        </div>
    );
}