// apps/web/src/components/generator/LiveGeneration.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, CheckCircle2, Image as ImageIcon, Sparkles, Code2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FinalOutlineData, GeneratedBlock } from "@/types/generator";

interface LiveGenerationProps {
    outlineData: FinalOutlineData;
    onComplete: (blocks: GeneratedBlock[]) => void;
}

export default function LiveGeneration({ outlineData, onComplete }: LiveGenerationProps) {
    const [blocks, setBlocks] = useState<GeneratedBlock[]>([]);
    const [isFinished, setIsFinished] = useState(false);
    const [currentTask, setCurrentTask] = useState("Initializing AI Engine and connecting to API...");
    const [progress, setProgress] = useState(0);

    const scrollRef = useRef<HTMLDivElement>(null);

    // Otomatik kaydırma (Auto-scroll)
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [blocks, currentTask]);

    // GERÇEK API BAĞLANTISI VE CANLI YAZIM SİMÜLASYONU
    useEffect(() => {
        let isMounted = true;

        const generateArticle = async () => {
            try {
                setProgress(10);

                // 1. ADIM: Arka plandaki API'mize (Senin Python mantığına) gerçek isteği atıyoruz
                const response = await fetch('/api/generate/article', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        outlineData: outlineData,
                        config: {} // Model, dil gibi ayarlar ileride buraya eklenecek
                    })
                });

                if (!response.ok) throw new Error("Generation API failed");

                const data = await response.json();
                const fetchedBlocks: GeneratedBlock[] = data.blocks;

                setCurrentTask("Content received! Rendering dynamically...");
                setProgress(30);

                // 2. ADIM: API'den gelen tüm veriyi bir anda ekrana basmak yerine, 
                // "Canlı Üretim" hissini korumak için sırayla (animasyonlu) ekliyoruz.
                const newBlocks: GeneratedBlock[] = [];
                const totalSteps = fetchedBlocks.length;

                for (let i = 0; i < fetchedBlocks.length; i++) {
                    if (!isMounted) return;

                    const currentBlock = fetchedBlocks[i];
                    newBlocks.push(currentBlock);
                    setBlocks([...newBlocks]); // Ekrana bloğu bas

                    // Bloğun türüne göre ekrandaki "Yükleniyor..." metnini güncelle
                    if (currentBlock.type === 'h2' || currentBlock.type === 'h3') {
                        setCurrentTask(`Writing section: ${currentBlock.content}...`);
                    } else if (currentBlock.type === 'paragraph') {
                        setCurrentTask(`Applying NLP algorithms and injecting backlinks...`);
                    } else if (currentBlock.type === 'image') {
                        setCurrentTask(`Triggering Image AI for visual context...`);
                    }

                    // İlerleme çubuğunu güncelle (30% ile 100% arası)
                    setProgress(30 + ((i + 1) / totalSteps) * 70);

                    // Daktilo/Üretim hissi için araya ufak bir gecikme koy (800ms)
                    await new Promise(r => setTimeout(r, 800));
                }

                // 3. ADIM: İşlem Tamamlandı
                if (isMounted) {
                    setIsFinished(true);
                    setCurrentTask("Generation Complete!");
                    setProgress(100);
                }

            } catch (error) {
                console.error(error);
                if (isMounted) {
                    setCurrentTask("An error occurred during generation.");
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
                                        <Sparkles size={12} /> DALL-E / Imagen Pipeline
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