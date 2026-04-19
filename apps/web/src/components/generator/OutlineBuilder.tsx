// apps/web/src/components/generator/OutlineBuilder.tsx
"use client";

import { useState, useEffect } from "react";
import { ListTree, Plus, Trash2, FileText, CheckCircle2, Wand2, GripVertical, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResearchResultData, FinalOutlineData, GeneratorConfigData } from "@/types/generator";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface OutlineBuilderProps {
    researchData: ResearchResultData;
    activeConfig: GeneratorConfigData | null; // FIX: Receive config to forward brand/sitemap settings
    onGenerateArticle: (data: FinalOutlineData) => void;
}

interface HeadingItem {
    id: string;
    level: 'h2' | 'h3';
    text: string;
}

function SortableHeadingItem({ item, onRemove }: { item: HeadingItem, onRemove: (id: string) => void }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        opacity: isDragging ? 0.6 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "flex items-center gap-3 bg-white dark:bg-gray-800 border p-3 rounded-xl shadow-sm transition-colors group",
                isDragging ? "border-blue-500 shadow-lg ring-1 ring-blue-500" : "border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700"
            )}
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-blue-500 transition-colors"
                aria-label="Drag to reorder"
            >
                <GripVertical size={18} />
            </div>

            <span className={cn(
                "font-bold uppercase tracking-wider text-[10px] py-1 px-2 rounded w-8 text-center flex-shrink-0",
                item.level === 'h2' ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 ml-4"
            )}>
                {item.level}
            </span>

            <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200">
                {item.text}
            </span>

            <button
                onClick={() => onRemove(item.id)}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                aria-label="Remove heading"
            >
                <Trash2 size={16} />
            </button>
        </div>
    );
}

export default function OutlineBuilder({ researchData, activeConfig, onGenerateArticle }: OutlineBuilderProps) {
    const [myOutline, setMyOutline] = useState<HeadingItem[]>([]);
    const [customHeading, setCustomHeading] = useState("");
    const [customLevel, setCustomLevel] = useState<'h2' | 'h3'>('h2');
    const [isAIGenerating, setIsAIGenerating] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    // AI Semantic Outline Generation Hook
    const handleAIDraftOutline = async () => {
        try {
            setIsAIGenerating(true);
            const targetTopic = (researchData as any).topic || researchData.keywords?.[0]?.text || "SEO Topic";

            // Dil ve marka bilgilerini API'ye aktar
            const targetLanguage = activeConfig?.language === 'tr' ? 'Turkish (TR)' : 'English (US)';
            const targetBrand = activeConfig?.enableBrandVoice ? (activeConfig.customBrandName || '') : '';
            const targetBrandDesc = activeConfig?.enableBrandVoice ? (activeConfig.customBrandDesc || '') : '';

            const response = await fetch('/api/generate/outline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: targetTopic,
                    researchData: researchData,
                    language: targetLanguage,
                    brandName: targetBrand,
                    brandDesc: targetBrandDesc
                })
            });

            if (!response.ok) throw new Error("AI Outline generation failed.");

            const data = await response.json();
            if (data.outline) {
                const formattedHeadings = data.outline.map((h: any, i: number) => ({
                    id: `ai-${i}-${Date.now()}`,
                    level: h.level as 'h2' | 'h3',
                    text: h.text
                }));
                setMyOutline(formattedHeadings);
            }
        } catch (error) {
            console.error(error);
            alert("Failed to generate AI outline. Please try again.");
        } finally {
            setIsAIGenerating(false);
        }
    };

    const handleAddFromCompetitor = (heading: { level: string, text: string }) => {
        setMyOutline(prev => [...prev, {
            id: `comp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            level: (heading.level === 'h1' ? 'h2' : heading.level) as 'h2' | 'h3',
            text: heading.text
        }]);
    };

    const handleAddCustom = (e: React.FormEvent) => {
        e.preventDefault();
        if (!customHeading.trim()) return;

        setMyOutline(prev => [...prev, {
            id: `custom-${Date.now()}`,
            level: customLevel,
            text: customHeading.trim()
        }]);
        setCustomHeading("");
    };

    const handleRemove = (id: string) => {
        setMyOutline(prev => prev.filter(item => item.id !== id));
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setMyOutline((items) => {
                const oldIndex = items.findIndex((item) => item.id === active.id);
                const newIndex = items.findIndex((item) => item.id === over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    const handleFinalize = () => {
        if (myOutline.length === 0) {
            alert("Please architect at least one heading into your outline before proceeding.");
            return;
        }

        const selectedKeywords = researchData.keywords
            ? researchData.keywords.filter((kw: any) => kw.selected).map((kw: any) => kw.text)
            : [];

        const competitorUrls = researchData.competitors
            ? researchData.competitors.filter((c: any) => c.selected).map((c: any) => c.url)
            : [];

        const finalData: FinalOutlineData = {
            headings: myOutline.map(h => ({ id: h.id, level: h.level, text: h.text })),
            selectedKeywords: selectedKeywords,
            sourceUrls: competitorUrls,
            config: activeConfig ?? undefined, // FIX: Forward brand voice & sitemap config to LiveGeneration
        };

        onGenerateArticle(finalData);
    };

    return (
        <div className="w-full max-w-6xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-500">

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <ListTree className="w-6 h-6 text-indigo-500" />
                        Outline Architect
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Engineer your document structure. Inject competitor headings, draft with AI, or craft custom sections.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleAIDraftOutline}
                        disabled={isAIGenerating}
                        className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2 rounded-lg font-bold shadow-md hover:scale-105 transition-all disabled:opacity-50"
                    >
                        {isAIGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {isAIGenerating ? "Synthesizing..." : "AI Draft Outline"}
                    </button>
                    <div className="flex items-center gap-3 bg-indigo-50 dark:bg-indigo-900/20 px-4 py-2 rounded-lg border border-indigo-100 dark:border-indigo-800/50">
                        <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400">Total:</span>
                        <span className="text-xl font-black text-indigo-600 dark:text-indigo-300">{myOutline.length}</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* LEFT DOMAIN: Competitor Serps */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm flex flex-col h-[700px]">
                    <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                        <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <FileText className="w-5 h-5 text-blue-500" />
                            SERP Topologies
                        </h3>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-6">
                        {researchData?.competitors?.filter((c: any) => c.selected).map((comp: any, idx: number) => (
                            <div key={idx} className="space-y-3">
                                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 sticky top-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm py-2 border-b border-gray-100 dark:border-gray-800 z-10 truncate">
                                    {comp.title}
                                </h4>
                                <div className="space-y-2 pl-2">
                                    {comp.headings?.map((heading: any, hIdx: number) => (
                                        <button
                                            key={hIdx}
                                            onClick={() => handleAddFromCompetitor(heading)}
                                            className="w-full flex items-start gap-3 p-2.5 rounded-lg border border-transparent hover:border-blue-200 hover:bg-blue-50 dark:hover:border-blue-900/50 dark:hover:bg-blue-900/20 text-left transition-colors group"
                                        >
                                            <span className={cn(
                                                "font-bold uppercase tracking-wider text-[10px] py-1 px-2 rounded w-8 text-center flex-shrink-0 mt-0.5",
                                                heading.level === 'h2' ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 ml-4"
                                            )}>
                                                {heading.level}
                                            </span>
                                            <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-700 dark:group-hover:text-blue-300">
                                                {heading.text}
                                            </span>
                                            <Plus className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 text-blue-500 flex-shrink-0 mt-0.5 transition-opacity" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* RIGHT DOMAIN: User Outline */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm flex flex-col h-[700px]">
                    <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex justify-between items-center">
                        <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Wand2 className="w-5 h-5 text-green-500" />
                            Target Architecture
                        </h3>
                    </div>

                    <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
                        <form onSubmit={handleAddCustom} className="flex gap-2">
                            <select
                                value={customLevel}
                                onChange={(e) => setCustomLevel(e.target.value as 'h2' | 'h3')}
                                className="w-20 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-bold rounded-lg px-2 focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                                <option value="h2">H2</option>
                                <option value="h3">H3</option>
                            </select>
                            <input
                                type="text"
                                value={customHeading}
                                onChange={(e) => setCustomHeading(e.target.value)}
                                placeholder="Inject custom heading directive..."
                                className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button type="submit" disabled={!customHeading.trim()} className="px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold rounded-lg disabled:opacity-50 hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors">
                                Add
                            </button>
                        </form>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 bg-gray-50/50 dark:bg-gray-900/50">
                        {myOutline.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-3">
                                <ListTree className="w-12 h-12 opacity-20" />
                                <p className="text-sm">Architecture is empty. Inject headings or use AI Draft.</p>
                            </div>
                        ) : (
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={myOutline.map(item => item.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <div className="space-y-2">
                                        {myOutline.map((item) => (
                                            <SortableHeadingItem
                                                key={item.id}
                                                item={item}
                                                onRemove={handleRemove}
                                            />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        )}
                    </div>

                    <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
                        <button
                            onClick={handleFinalize}
                            disabled={myOutline.length === 0}
                            className="w-full flex items-center justify-center py-3.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold rounded-xl shadow-md hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 transition-all hover:scale-[1.02]"
                        >
                            <CheckCircle2 className="w-5 h-5 mr-2" />
                            Lock Architecture & Initialize Production
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}