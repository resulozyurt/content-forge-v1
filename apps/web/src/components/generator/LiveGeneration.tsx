// apps/web/src/components/generator/LiveGeneration.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, CheckCircle2, Sparkles, Code2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FinalOutlineData, GeneratedBlock } from "@/types/generator";
import DOMPurify from "isomorphic-dompurify"; // Required for XSS sanitization

interface LiveGenerationProps {
    outlineData: FinalOutlineData;
    onComplete: (blocks: GeneratedBlock[]) => void;
}

export default function LiveGeneration({ outlineData, onComplete }: LiveGenerationProps) {
    const [blocks, setBlocks] = useState<GeneratedBlock[]>([]);
    const [isFinished, setIsFinished] = useState(false);
    const [currentTask, setCurrentTask] = useState("Initializing AI Engine and establishing secure stream...");
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const hasStarted = useRef(false); // Prevents React Strict Mode double-execution

    // Auto-scroll mechanism to keep the latest generated content in view
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [blocks, currentTask]);

    // REAL-TIME API CONNECTION AND STREAM PARSING
    useEffect(() => {
        if (hasStarted.current) return;
        hasStarted.current = true;
        let isMounted = true;

        const generateArticle = async () => {
            try {
                setProgress(10);
                setCurrentTask("Connecting to generation pipeline...");

                // 1. Dispatch POST request to the SSE streaming endpoint
                const response = await fetch('/api/generate/article', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        outlineData: outlineData,
                        config: {} // Extensible configuration payload (model, language, etc.)
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.message || "Generation pipeline failed to initialize.");
                }

                if (!response.body) {
                    throw new Error("ReadableStream architecture is not supported by the current server response.");
                }

                setProgress(25);
                setCurrentTask("Stream established. Awaiting incoming content blocks...");

                // 2. Initialize the stream reader and text decoder
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");
                let done = false;

                // Track blocks internally to update progress dynamically
                let processedBlocksCount = 0;
                const estimatedTotalBlocks = (outlineData.headings?.length || 5) * 2;

                // 3. Process the incoming chunked data stream continuously
                while (!done) {
                    const { value, done: readerDone } = await reader.read();
                    done = readerDone;

                    if (value) {
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split("\n\n");

                        for (const line of lines) {
                            if (line.startsWith("data: ")) {
                                const dataStr = line.replace("data: ", "").trim();

                                // Detect the termination signal from the backend
                                if (dataStr === "[DONE]") {
                                    if (isMounted) {
                                        setIsFinished(true);
                                        setCurrentTask("Generation Complete!");
                                        setProgress(100);
                                    }
                                    break;
                                }

                                try {
                                    const parsedBlock = JSON.parse(dataStr) as GeneratedBlock;
                                    processedBlocksCount++;

                                    // Append the new block to the UI state incrementally
                                    if (isMounted) {
                                        setBlocks((prev) => [...prev, parsedBlock]);

                                        // Update the dynamic status indicator based on the block type
                                        if (parsedBlock.type === 'h2' || parsedBlock.type === 'h3') {
                                            setCurrentTask(`Drafting section: ${parsedBlock.content.substring(0, 40)}...`);
                                        } else if (parsedBlock.type === 'paragraph') {
                                            setCurrentTask(`Applying NLP algorithms and optimizing keyword density...`);
                                        } else if (parsedBlock.type === 'image') {
                                            setCurrentTask(`Engineering precise text prompts for visual assets...`);
                                        }

                                        // Calculate a smooth progress curve based on received chunks
                                        const currentProgress = 25 + Math.min((processedBlocksCount / estimatedTotalBlocks) * 70, 70);
                                        setProgress(currentProgress);
                                    }
                                } catch (e) {
                                    console.warn("[STREAM_PARSE_WARNING] Encountered a fragmented chunk, skipping rendering.", e);
                                }
                            }
                        }
                    }
                }

            } catch (err: any) {
                console.error("[GENERATION_FAULT]:", err);
                if (isMounted) {
                    setError(err.message || "A critical fault interrupted the generation sequence.");
                    setCurrentTask("Process halted due to an error.");
                }
            }
        };

        generateArticle();

        return () => { isMounted = false; };
    }, [outlineData]);

    return (
        <div className="w-full max-w-5xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-500">

            {/* Header & Progress Bar */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={cn("p-2 rounded-lg",
                            isFinished ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" :
                                error ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" :
                                    "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse"
                        )}>
                            {isFinished ? <CheckCircle2 size={24} /> : <Code2 size={24} />}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                {isFinished ? "Content Successfully Generated" :
                                    error ? "Pipeline Execution Failed" :
                                        "AI Production Engine Running..."}
                            </h2>
                            <p className={cn("text-sm font-medium mt-0.5 flex items-center gap-2",
                                error ? "text-red-500" : "text-gray-500 dark:text-gray-400"
                            )}>
                                {!isFinished && !error && <Loader2 size={14} className="animate-spin" />}
                                {error ? error : currentTask}
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

                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                        className={cn("h-2 rounded-full transition-all duration-500 ease-out",
                            error ? "bg-red-500" : "bg-gradient-to-r from-blue-600 to-indigo-600"
                        )}
                        style={{ width: `${error ? 100 : progress}%` }}
                    ></div>
                </div>
            </div>

            {/* Live Terminal / Document View */}
            <div
                ref={scrollRef}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-inner overflow-y-auto p-8 h-[600px] scroll-smooth"
            >
                <div className="max-w-3xl mx-auto space-y-6">
                    {blocks.length === 0 && !error && (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4 opacity-50 pt-20">
                            <Sparkles size={48} className="animate-pulse" />
                            <p>Connecting to AI microservices...</p>
                        </div>
                    )}

                    {blocks.map((block) => (
                        <div key={block.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                            {block.type === 'h2' && (
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mt-8 mb-4 border-b border-gray-100 dark:border-gray-800 pb-2">
                                    {block.content}
                                </h2>
                            )}
                            {block.type === 'h3' && (
                                <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mt-6 mb-3">
                                    {block.content}
                                </h3>
                            )}
                            {/* CRUCIAL: Prevent XSS attacks by sanitizing LLM output before injecting into the DOM */}
                            {block.type === 'paragraph' && (
                                <p
                                    className="text-gray-600 dark:text-gray-300 leading-relaxed text-lg"
                                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(block.content) }}
                                />
                            )}
                            {block.type === 'image' && (
                                <div
                                    className="my-8 animate-in fade-in zoom-in duration-500"
                                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(block.content) }}
                                />
                            )}
                        </div>
                    ))}

                    {/* Blinking Cursor */}
                    {!isFinished && !error && blocks.length > 0 && (
                        <div className="w-3 h-6 bg-blue-500 animate-pulse mt-4"></div>
                    )}
                </div>
            </div>
        </div>
    );
}