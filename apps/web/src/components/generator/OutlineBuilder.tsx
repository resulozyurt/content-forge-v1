// apps/web/src/components/generator/OutlineBuilder.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import {
    DndContext, closestCenter, KeyboardSensor, PointerSensor,
    useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
    arrayMove, SortableContext, sortableKeyboardCoordinates,
    verticalListSortingStrategy, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    GripVertical, Trash2, ListTree, FileText, CheckCircle2,
    Sparkles, Loader2, RefreshCw, Pencil, Check, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FinalOutlineData, ResearchResultData, GeneratorConfigData } from "@/types/generator";

type HeadingLevel = "h2" | "h3" | "h4";

interface HeadingItem {
    id: string;
    level: HeadingLevel;
    text: string;
}

interface OutlineBuilderProps {
    researchData: ResearchResultData;
    activeConfig: GeneratorConfigData | null;
    onGenerateArticle: (data: FinalOutlineData) => void;
}

// ---------------------------------------------------------------------------
// Sortable heading item with inline editing
// ---------------------------------------------------------------------------
function SortableHeadingItem({
    item, onRemove, onUpdate,
}: {
    item: HeadingItem;
    onRemove: (id: string) => void;
    onUpdate: (id: string, text: string) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: item.id });

    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(item.text);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isEditing) inputRef.current?.focus();
    }, [isEditing]);

    const startEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditValue(item.text);
        setIsEditing(true);
    };

    const saveEdit = () => {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== item.text) onUpdate(item.id, trimmed);
        setIsEditing(false);
    };

    const cancelEdit = () => {
        setEditValue(item.text);
        setIsEditing(false);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") saveEdit();
        if (e.key === "Escape") cancelEdit();
    };

    const style = { transform: CSS.Transform.toString(transform), transition };

    const levelColors: Record<HeadingLevel, string> = {
        h2: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400",
        h3: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 ml-4",
        h4: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 ml-8",
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "flex items-center gap-2 p-2.5 rounded-lg border bg-white dark:bg-gray-900 transition-all group",
                isDragging
                    ? "border-indigo-300 shadow-lg opacity-80"
                    : "border-gray-200 dark:border-gray-700 hover:border-indigo-200 dark:hover:border-indigo-800"
            )}
        >
            {/* Drag handle — disabled while editing */}
            <button
                {...attributes}
                {...(isEditing ? {} : listeners)}
                tabIndex={-1}
                className={cn(
                    "text-gray-300 flex-shrink-0 transition-colors",
                    isEditing ? "cursor-default opacity-20" : "hover:text-gray-500 cursor-grab active:cursor-grabbing"
                )}
            >
                <GripVertical size={15} />
            </button>

            {/* Level badge */}
            <span className={cn(
                "font-bold uppercase tracking-wider text-[10px] py-1 px-2 rounded w-8 text-center flex-shrink-0",
                levelColors[item.level]
            )}>
                {item.level}
            </span>

            {/* Text — edit mode or display */}
            {isEditing ? (
                <input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={saveEdit}
                    className="flex-1 text-sm font-medium bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-300 dark:border-indigo-600 rounded px-2 py-1 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
            ) : (
                <span
                    className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate cursor-text"
                    onDoubleClick={startEdit}
                    title="Double-click to edit"
                >
                    {item.text}
                </span>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-1 flex-shrink-0">
                {isEditing ? (
                    <>
                        <button onClick={saveEdit} title="Save (Enter)"
                            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors">
                            <Check size={13} />
                        </button>
                        <button onClick={cancelEdit} title="Cancel (Esc)"
                            className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors">
                            <X size={13} />
                        </button>
                    </>
                ) : (
                    <>
                        <button onClick={startEdit} title="Edit heading"
                            className="p-1.5 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded transition-colors opacity-0 group-hover:opacity-100">
                            <Pencil size={13} />
                        </button>
                        <button onClick={() => onRemove(item.id)} title="Remove"
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">
                            <Trash2 size={13} />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function OutlineBuilder({ researchData, activeConfig, onGenerateArticle }: OutlineBuilderProps) {
    const [myOutline, setMyOutline] = useState<HeadingItem[]>([]);
    const [customHeading, setCustomHeading] = useState("");
    const [customLevel, setCustomLevel] = useState<HeadingLevel>("h2");
    const [isAIGenerating, setIsAIGenerating] = useState(false);
    const [allPreviousHeadings, setAllPreviousHeadings] = useState<string[]>([]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleAIDraftOutline = async () => {
        try {
            setIsAIGenerating(true);
            const targetTopic = (researchData as any).topic || researchData.keywords?.[0]?.text || "SEO Topic";
            const targetLanguage = activeConfig?.language === "tr" ? "Turkish (TR)" : "English (US)";
            const targetBrand = activeConfig?.enableBrandVoice ? activeConfig.customBrandName || "" : "";
            const targetBrandDesc = activeConfig?.enableBrandVoice ? activeConfig.customBrandDesc || "" : "";
            const avoidList = Array.from(new Set([...allPreviousHeadings, ...myOutline.map((h) => h.text)]));

            const res = await fetch("/api/generate/outline", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    topic: targetTopic, researchData, language: targetLanguage,
                    brandName: targetBrand, brandDesc: targetBrandDesc, previousHeadings: avoidList,
                }),
            });
            if (!res.ok) throw new Error("AI Outline generation failed.");
            const data = await res.json();

            if (data.outline) {
                const formatted: HeadingItem[] = data.outline.map((h: any, i: number) => ({
                    id: `ai-${i}-${Date.now()}`,
                    level: (["h2", "h3", "h4"].includes(h.level) ? h.level : "h2") as HeadingLevel,
                    text: h.text,
                }));
                setMyOutline(formatted);
                setAllPreviousHeadings((prev) =>
                    Array.from(new Set([...prev, ...formatted.map((h) => h.text)]))
                );
            }
        } catch (err) {
            console.error(err);
            alert("Failed to generate AI outline. Please try again.");
        } finally {
            setIsAIGenerating(false);
        }
    };

    const handleAddFromCompetitor = (heading: { level: string; text: string }) => {
        const safe = (["h2", "h3", "h4"].includes(heading.level) ? heading.level : "h2") as HeadingLevel;
        setMyOutline((p) => [...p, { id: `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, level: safe, text: heading.text }]);
    };

    const handleAddCustom = (e: React.FormEvent) => {
        e.preventDefault();
        if (!customHeading.trim()) return;
        setMyOutline((p) => [...p, { id: `custom-${Date.now()}`, level: customLevel, text: customHeading.trim() }]);
        setCustomHeading("");
    };

    const handleRemove = (id: string) => setMyOutline((p) => p.filter((h) => h.id !== id));
    const handleUpdate = (id: string, text: string) => setMyOutline((p) => p.map((h) => h.id === id ? { ...h, text } : h));

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setMyOutline((items) => {
                const old = items.findIndex((h) => h.id === active.id);
                const nw = items.findIndex((h) => h.id === over.id);
                return arrayMove(items, old, nw);
            });
        }
    };

    const handleFinalize = () => {
        if (!myOutline.length) { alert("Please add at least one heading before proceeding."); return; }
        const selectedKeywords = researchData.keywords?.filter((kw: any) => kw.selected).map((kw: any) => kw.text) ?? [];
        const competitorUrls = researchData.competitors?.filter((c: any) => c.selected).map((c: any) => c.url) ?? [];
        onGenerateArticle({
            headings: myOutline.map((h) => ({ id: h.id, level: h.level, text: h.text })),
            selectedKeywords, sourceUrls: competitorUrls, config: activeConfig ?? undefined,
        });
    };

    const h2Count = myOutline.filter((h) => h.level === "h2").length;
    const h3Count = myOutline.filter((h) => h.level === "h3").length;
    const h4Count = myOutline.filter((h) => h.level === "h4").length;

    return (
        <div className="w-full max-w-6xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <ListTree className="w-6 h-6 text-indigo-500" /> Outline Architect
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Click <span className="text-indigo-500 font-medium">AI Draft Outline</span> to generate an outline with AI, or <span className="text-indigo-500 font-medium">double-click</span> any heading to add a new heading manually.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleAIDraftOutline}
                        disabled={isAIGenerating}
                        className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2 rounded-lg font-bold shadow-md hover:scale-105 transition-all disabled:opacity-50"
                    >
                        {isAIGenerating ? <Loader2 className="w-4 h-4 animate-spin" />
                            : myOutline.length > 0 ? <RefreshCw className="w-4 h-4" />
                                : <Sparkles className="w-4 h-4" />}
                        {isAIGenerating ? "Generating Outline..."
                            : myOutline.length > 0 ? "Generate a New Outline"
                                : "AI Draft Outline"}
                    </button>
                    <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/20 px-4 py-2 rounded-lg border border-indigo-100 dark:border-indigo-800/50 text-sm font-bold text-indigo-700 dark:text-indigo-400">
                        <span>Total: {myOutline.length}</span>
                        {h2Count > 0 && (
                            <span className="text-xs opacity-60">
                                ({h2Count}×H2 {h3Count}×H3{h4Count > 0 ? ` ${h4Count}×H4` : ""})
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* LEFT: Competitor SERPs */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm flex flex-col h-[700px]">
                    <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                        <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <FileText className="w-5 h-5 text-blue-500" /> Competitor Outlines
                        </h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {researchData?.competitors?.filter((c: any) => c.selected).map((comp: any, idx: number) => (
                            <div key={idx} className="space-y-2">
                                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 sticky top-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm py-2 border-b border-gray-100 dark:border-gray-800 z-10 truncate">
                                    {comp.title}
                                </h4>
                                <div className="space-y-1 pl-2">
                                    {comp.headings?.map((heading: any, hIdx: number) => (
                                        <button key={hIdx} onDoubleClick={() => handleAddFromCompetitor(heading)}
                                            title="Double-click to add"
                                            className="w-full flex items-start gap-3 p-2 rounded-lg border border-transparent hover:border-blue-200 hover:bg-blue-50 dark:hover:border-blue-900/50 dark:hover:bg-blue-900/20 text-left transition-colors group cursor-pointer">
                                            <span className={cn(
                                                "font-bold uppercase tracking-wider text-[10px] py-1 px-2 rounded w-8 text-center flex-shrink-0 mt-0.5",
                                                heading.level === "h2" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400"
                                                    : heading.level === "h4" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                                                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 ml-2"
                                            )}>
                                                {heading.level}
                                            </span>
                                            <span className="flex-1 text-sm text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                                                {heading.text}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* RIGHT: Target Architecture */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm flex flex-col h-[700px]">
                    <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                        <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-purple-500" /> Target Architecture
                        </h3>
                    </div>

                    {/* Custom input */}
                    <div className="p-3 border-b border-gray-100 dark:border-gray-800">
                        <form onSubmit={handleAddCustom} className="flex gap-2">
                            <select value={customLevel} onChange={(e) => setCustomLevel(e.target.value as HeadingLevel)}
                                className="text-xs font-bold border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                                <option value="h2">H2</option>
                                <option value="h3">H3</option>
                                <option value="h4">H4</option>
                            </select>
                            <input type="text" value={customHeading} onChange={(e) => setCustomHeading(e.target.value)}
                                placeholder="Inject custom heading directive..."
                                className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                            <button type="submit"
                                className="px-4 py-2 bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 text-sm font-bold rounded-lg hover:bg-gray-700 transition-colors">
                                Add
                            </button>
                        </form>
                    </div>

                    {/* Sortable list */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {myOutline.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-3">
                                <ListTree className="w-12 h-12 opacity-20" />
                                <p className="text-sm">Architecture is empty. Inject headings or use AI Draft.</p>
                            </div>
                        ) : (
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                <SortableContext items={myOutline.map((h) => h.id)} strategy={verticalListSortingStrategy}>
                                    <div className="space-y-1.5">
                                        {myOutline.map((item) => (
                                            <SortableHeadingItem key={item.id} item={item} onRemove={handleRemove} onUpdate={handleUpdate} />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        )}
                    </div>

                    {/* Finalize */}
                    <div className="p-4 border-t border-gray-100 dark:border-gray-800">
                        <button onClick={handleFinalize} disabled={myOutline.length === 0}
                            className="w-full flex items-center justify-center py-3.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold rounded-xl shadow-md hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 transition-all hover:scale-[1.02]">
                            <CheckCircle2 className="w-5 h-5 mr-2" />
                            Lock Architecture & Initialize Production
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}