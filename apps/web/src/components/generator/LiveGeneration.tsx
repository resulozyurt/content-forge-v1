// apps/web/src/components/generator/LiveGeneration.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, CheckCircle2, Image as ImageIcon, Link as LinkIcon, Sparkles, Code2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FinalOutlineData, GeneratedBlock } from "@/types/generator";

interface LiveGenerationProps {
    outlineData: FinalOutlineData;
    onComplete: (blocks: GeneratedBlock[]) => void;
}

export default function LiveGeneration({ outlineData, onComplete }: LiveGenerationProps) {
    const [blocks, setBlocks] = useState<GeneratedBlock[]>([]);
    const [isFinished, setIsFinished] = useState(false);
    const [currentTask, setCurrentTask] = useState("Initializing NLP Engine...");
    const [progress, setProgress] = useState(0);

    const scrollRef = useRef<HTMLDivElement>(null);

    // Otomatik kaydırma (Auto-scroll)
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [blocks, currentTask]);

    // Python AI & NLP Simülasyon Motoru
    useEffect(() => {
        let isMounted = true;
        let h2Counter = 0;

        const generateArticle = async () => {
            const newBlocks: GeneratedBlock[] = [];
            const totalSteps = outlineData.headings.length * 2; // Her başlık için (Başlık + Paragraf)
            let currentStep = 0;

            // Yapay Zekayı Başlatma Gecikmesi
            await new Promise(r => setTimeout(r, 1500));

            for (let i = 0; i < outlineData.headings.length; i++) {
                if (!isMounted) return;

                const heading = outlineData.headings[i];

                // 1. Başlığı Ekle
                setCurrentTask(`Writing section: ${heading.text}...`);
                await new Promise(r => setTimeout(r, 800));

                const headingBlock: GeneratedBlock = {
                    id: `h-${i}`,
                    type: heading.level,
                    content: heading.text,
                };
                newBlocks.push(headingBlock);
                setBlocks([...newBlocks]);

                if (heading.level === 'h2') h2Counter++;

                // 2. Paragraf Üretimi (Backlink ve Keyword entegrasyonu simülasyonu)
                setCurrentTask(`Applying NLP algorithms and injecting backlinks for: ${heading.text}...`);
                await new Promise(r => setTimeout(r, 1500)); // Paragraf yazma süresi

                // Simüle edilmiş paragraf metni (İçinde SEO kelimeleri ve Backlink var)
                const sampleKeyword = outlineData.selectedKeywords.length > 0
                    ? outlineData.selectedKeywords[i % outlineData.selectedKeywords.length]
                    : "industry standard";

                const paragraphBlock: GeneratedBlock = {
                    id: `p-${i}`,
                    type: 'paragraph',
                    content: `This section explores the core aspects of ${heading.text}. When evaluating the landscape, it becomes clear that prioritizing <strong class="text-blue-600">${sampleKeyword}</strong> is crucial for long-term success. According to recent industry reports <a href="#" class="text-indigo-500 underline decoration-indigo-300 hover:text-indigo-700 transition-colors" title="Simulated Backlink">[Source: TechInsights 2026]</a>, organizations that adapt to these methodologies see a significant increase in overall efficiency.`,
                };
                newBlocks.push(paragraphBlock);
                setBlocks([...newBlocks]);

                currentStep += 2;
                setProgress((currentStep / totalSteps) * 100);

                // 3. GÖRSEL ÜRETİMİ (HER 2 ADET H2'DE BİR)
                if (heading.level === 'h2' && h2Counter % 2 === 0) {
                    setCurrentTask(`Triggering Image AI: Generating contextual image for previous sections...`);
                    await new Promise(r => setTimeout(r, 2000)); // Görsel üretimi daha uzun sürer

                    const imageBlock: GeneratedBlock = {
                        id: `img-${i}`,
                        type: 'image',
                        content: `A highly detailed, professional illustration representing ${heading.text}, corporate style, modern colors, 8k resolution.`, // Bu aslında bizim DALL-E/Midjourney promptumuz
                    };
                    newBlocks.push(imageBlock);
                    setBlocks([...newBlocks]);
                }
            }

            // Üretim Bitti
            setCurrentTask("Finalizing content structure and calculating SEO scores...");
            await new Promise(r => setTimeout(r, 1000));
            setIsFinished(true);
            setCurrentTask("Generation Complete!");
            setProgress(100);
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
                        <div className={cn("p-2 rounded-lg", isFinished ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse")}>
                            {isFinished ? <CheckCircle2 size={24} /> : <Code2 size={24} />}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                {isFinished ? "Content Successfully Generated" : "AI Production Engine Running..."}
                            </h2>
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2">
                                {!isFinished && <Loader2 size={14} className="animate-spin" />}
                                {currentTask}
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
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 h-2 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
            </div>

            {/* Canlı Yazım Ekranı (Terminal / Document View) */}
            <div
                ref={scrollRef}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-inner overflow-y-auto p-8 h-[600px] scroll-smooth"
            >
                <div className="max-w-3xl mx-auto space-y-6">
                    {blocks.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4 opacity-50 pt-20">
                            <Sparkles size={48} className="animate-pulse" />
                            <p>Connecting to Python NLP microservices...</p>
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
                            {block.type === 'paragraph' && (
                                <p
                                    className="text-gray-600 dark:text-gray-300 leading-relaxed text-lg"
                                    dangerouslySetInnerHTML={{ __html: block.content }}
                                />
                            )}
                            {block.type === 'image' && (
                                <div className="my-8 rounded-xl border-2 border-dashed border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-900/10 p-8 flex flex-col items-center justify-center text-center relative overflow-hidden group">
                                    <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/5 to-purple-500/5 group-hover:opacity-100 transition-opacity" />
                                    <ImageIcon size={40} className="text-indigo-400 mb-3" />
                                    <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-300 mb-1">AI Image Generated</h4>
                                    <p className="text-xs text-indigo-600/70 dark:text-indigo-400/70 max-w-md italic">
                                        Prompt: "{block.content}"
                                    </p>
                                    <div className="mt-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 px-3 py-1 rounded-full">
                                        <Sparkles size={12} /> Stable Diffusion / DALL-E Pipeline
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Yanıp sönen imleç (Cursor) */}
                    {!isFinished && blocks.length > 0 && (
                        <div className="w-3 h-6 bg-blue-500 animate-pulse mt-4"></div>
                    )}
                </div>
            </div>
        </div>
    );
}