// apps/web/src/components/generator/LiveGeneration.tsx
"use client";

import { useEffect, useRef, useMemo } from "react";
import { Loader2, CheckCircle2, Sparkles, Code2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FinalOutlineData, GeneratedBlock } from "@/types/generator";
import DOMPurify from "isomorphic-dompurify";
import { useContentEngine } from "@/hooks/useContentEngine"; // V2 Multi-Agent Engine Hook

interface LiveGenerationProps {
    outlineData: FinalOutlineData & { config?: any };
    onComplete: (blocks: GeneratedBlock[]) => void;
}

export default function LiveGeneration({ outlineData, onComplete }: LiveGenerationProps) {
    // 1. Initialize the V2 Engine
    const {
        status,
        currentSectionName,
        generatedContent,
        errorMessage,
        startGeneration
    } = useContentEngine();

    const scrollRef = useRef<HTMLDivElement>(null);
    const executionLock = useRef(false);

    // 2. Auto-scroll to bottom as content flows in from the agents
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [generatedContent, status]);

    // 3. Kickoff the Multi-Agent Pipeline on mount
    useEffect(() => {
        if (executionLock.current) return;
        executionLock.current = true;

        // Map user config to V2 Engine parameters
        const keyword = outlineData.selectedKeywords?.[0] || outlineData.headings?.[0]?.title || "Target Keyword";

        // Isolate language parameter for the V2 Localization Engine
        let targetLanguage: "en-US" | "tr-TR" | "es-ES" = "en-US";
        const configLang = outlineData.config?.language?.toLowerCase() || "";
        if (configLang.includes("türk") || configLang.includes("tr")) targetLanguage = "tr-TR";
        if (configLang.includes("spanish") || configLang.includes("es")) targetLanguage = "es-ES";

        // Trigger Agent Pipeline
        startGeneration({ keyword, targetLanguage });

        // Cleanup lock if component unmounts prematurely
        return () => { executionLock.current = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 4. Dynamic Process Transparency Mapping
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
            case "WRITING_SECTION": return `✍️ Drafting section: ${currentSectionName || '...'}`;
            case "QA_CHECK": return `🛡️ Running strict format & readability checks on: ${currentSectionName || '...'}`;
            case "COMPLETED": return "Generation Complete!";
            default: return "Processing...";
        }
    }, [status, currentSectionName, errorMessage]);

    // 5. Transform V2 Raw Markdown into UI Blocks (Backward Compatibility for ProseEditor)
    const blocks = useMemo<GeneratedBlock[]>(() => {
        if (!generatedContent) return [];
        const rawChunks = generatedContent.split('\n\n').filter(b => b.trim().length > 0);

        return rawChunks.map((chunk, i) => {
            const id = `v2-block-${i}`;

            if (chunk.startsWith('## ')) {
                return { id, type: 'h2', content: chunk.replace('## ', '').trim() };
            }
            if (chunk.startsWith('### ')) {
                return { id, type: 'h3', content: chunk.replace('### ', '').trim() };
            }
            if (chunk.includes('[IMAGE_PROMPT:')) {
                const promptText = chunk.match(/\[IMAGE_PROMPT:(.*?)\]/)?.[1] || "Visual Asset Prompt";
                const formatted = `<div class="bg-indigo-50 border border-indigo-200 p-4 rounded-xl text-indigo-900 text-sm font-mono shadow-sm"><span class="font-bold flex items-center gap-2 mb-1">📸 Nano Banana 2 Image Engine</span> ${promptText}</div>`;
                return { id, type: 'image', content: formatted };
            }

            // Format basic markdown semantics to HTML for UI rendering
            let htmlContent = chunk
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>');

            // Detect and format Bullet Lists
            if (htmlContent.startsWith('- ') || htmlContent.startsWith('* ')) {
                const listItems = htmlContent.split('\n').map(item => `<li>${item.replace(/^[-*]\s/, '')}</li>`).join('');
                htmlContent = `<ul class="list-disc pl-6 my-2 space-y-1">${listItems}</ul>`;
            }

            // Detect and format Markdown Tables
            if (htmlContent.includes('|---|')) {
                htmlContent = `<div class="overflow-x-auto my-4"><pre class="text-xs bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">${chunk}</pre></div>`;
            }

            return { id, type: 'paragraph', content: htmlContent };
        });
    }, [generatedContent]);

    // 6. UI Render Layer
    return (
        <div className="w-full max-w-5xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-500">
            {/* Header Dashboard */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={cn("p-2 rounded-lg",
                            isFinished ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" :
                                errorMessage ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" :
                                    "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse"
                        )}>
                            {isFinished ? <CheckCircle2 size={24} /> : <Code2 size={24} />}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                {isFinished ? "Content Successfully Generated" :
                                    errorMessage ? "Pipeline Execution Failed" :
                                        "Multi-Agent Production Engine Running..."}
                            </h2>
                            <p className={cn("text-sm font-medium mt-0.5 flex items-center gap-2",
                                errorMessage ? "text-red-500" : "text-gray-500 dark:text-gray-400"
                            )}>
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
                            Open in ProseMirror Editor
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </button>
                    )}
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                        className={cn("h-2 rounded-full transition-all duration-500 ease-out",
                            errorMessage ? "bg-red-500" : "bg-gradient-to-r from-blue-600 to-indigo-600"
                        )}
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
            </div>

            {/* Content Output Viewport */}
            <div
                ref={scrollRef}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-inner overflow-y-auto p-8 h-[600px] scroll-smooth"
            >
                <div className="max-w-3xl mx-auto space-y-6">
                    {blocks.length === 0 && !errorMessage && (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4 opacity-50 pt-20">
                            <Sparkles size={48} className="animate-pulse" />
                            <p>Connecting to AI microservices...</p>
                        </div>
                    )}

                    {blocks.map((block) => (
                        <div key={block.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                            {block.type === 'h2' && typeof block.content === 'string' && (
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mt-8 mb-4 border-b border-gray-100 dark:border-gray-800 pb-2">
                                    {block.content}
                                </h2>
                            )}
                            {block.type === 'h3' && typeof block.content === 'string' && (
                                <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mt-6 mb-3">
                                    {block.content}
                                </h3>
                            )}
                            {block.type === 'paragraph' && typeof block.content === 'string' && (
                                <p
                                    className="text-gray-600 dark:text-gray-300 leading-relaxed text-lg"
                                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(block.content) }}
                                />
                            )}
                            {block.type === 'image' && typeof block.content === 'string' && (
                                <div
                                    className="my-8 animate-in fade-in zoom-in duration-500"
                                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(block.content) }}
                                />
                            )}
                        </div>
                    ))}

                    {status === "WRITING_SECTION" && (
                        <div className="w-3 h-6 bg-blue-500 animate-pulse mt-4"></div>
                    )}
                </div>
            </div>
        </div>
    );
}