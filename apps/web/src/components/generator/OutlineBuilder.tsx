// apps/web/src/components/generator/OutlineBuilder.tsx
"use client";

import { useState } from "react";
import { Plus, Trash2, GripVertical, Sparkles, FileText, LayoutList, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResearchResultData, OutlineHeading, FinalOutlineData } from "@/types/generator";

interface OutlineBuilderProps {
    researchData: ResearchResultData;
    onGenerateArticle: (finalData: FinalOutlineData) => void;
}

export default function OutlineBuilder({ researchData, onGenerateArticle }: OutlineBuilderProps) {
    const [headings, setHeadings] = useState<OutlineHeading[]>([
        { id: '1', text: "Introduction to the Topic", level: 'h2' },
        { id: '2', text: "Key Benefits and Features", level: 'h2' },
        { id: '3', text: "Technical Specifications", level: 'h3' },
        { id: '4', text: "Conclusion and Final Verdict", level: 'h2' },
    ]);

    // YENİ: Kelimeleri obje dizisi olarak tutuyoruz (Aktif/Deaktif yapabilmek için)
    const [keywordList, setKeywordList] = useState<{ text: string, isActive: boolean }[]>(
        researchData.keywords.filter(k => k.selected).map(k => ({ text: k.text, isActive: true }))
    );

    // YENİ: Manuel eklenecek kelime için state
    const [newKeyword, setNewKeyword] = useState("");

    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    const handleDragStart = (index: number) => {
        setDraggedIndex(index);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = (dropIndex: number) => {
        if (draggedIndex === null || draggedIndex === dropIndex) return;

        const newHeadings = [...headings];
        const draggedItem = newHeadings[draggedIndex];

        newHeadings.splice(draggedIndex, 1);
        newHeadings.splice(dropIndex, 0, draggedItem);

        setHeadings(newHeadings);
        setDraggedIndex(null);
    };

    const insertHeadingBelow = (index: number, level: 'h2' | 'h3') => {
        const newId = Math.random().toString(36).substr(2, 9);
        const newHeadings = [...headings];
        newHeadings.splice(index + 1, 0, { id: newId, text: "", level });
        setHeadings(newHeadings);
    };

    const appendHeading = (level: 'h2' | 'h3') => {
        const newId = Math.random().toString(36).substr(2, 9);
        setHeadings([...headings, { id: newId, text: "", level }]);
    };

    const removeHeading = (id: string) => {
        setHeadings(headings.filter(h => h.id !== id));
    };

    const updateHeadingText = (id: string, text: string) => {
        setHeadings(headings.map(h => h.id === id ? { ...h, text } : h));
    };

    // YENİ: Kelime Durumunu Değiştir (Aktif <-> Deaktif)
    const toggleKeywordActive = (index: number) => {
        const updatedList = [...keywordList];
        updatedList[index].isActive = !updatedList[index].isActive;
        setKeywordList(updatedList);
    };

    // YENİ: Manuel Kelime Ekleme
    const handleAddKeyword = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const trimmed = newKeyword.trim();
        if (!trimmed) return;

        // Aynı kelimeden varsa ekleme
        if (keywordList.some(k => k.text.toLowerCase() === trimmed.toLowerCase())) {
            setNewKeyword("");
            return;
        }

        setKeywordList([...keywordList, { text: trimmed, isActive: true }]);
        setNewKeyword("");
    };

    const handleFinish = () => {
        onGenerateArticle({
            headings: headings.filter(h => h.text.trim() !== ""),
            // Sadece 'isActive' olanları gönderiyoruz
            selectedKeywords: keywordList.filter(k => k.isActive).map(k => k.text)
        });
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Sol Panel: Seçili Anahtar Kelimeler */}
            <div className="lg:col-span-4 space-y-6">
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm sticky top-8">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        Selected Keywords
                    </h3>

                    <div className="flex flex-wrap gap-2 mb-4">
                        {keywordList.map((kw, i) => (
                            <span
                                key={i}
                                onClick={() => toggleKeywordActive(i)}
                                className={cn(
                                    "group flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer",
                                    kw.isActive
                                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-800 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                                        : "bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 line-through hover:bg-green-50 hover:text-green-600 hover:border-green-200 hover:no-underline"
                                )}
                            >
                                {kw.text}
                                {kw.isActive
                                    ? <X className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                                    : <Plus className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                                }
                            </span>
                        ))}
                        {keywordList.length === 0 && (
                            <p className="text-xs text-gray-400 w-full">No keywords selected.</p>
                        )}
                    </div>

                    {/* YENİ: Kelime Ekleme Inputu */}
                    <form onSubmit={handleAddKeyword} className="flex items-center gap-2 border-t border-gray-100 dark:border-gray-800 pt-4">
                        <input
                            type="text"
                            value={newKeyword}
                            onChange={(e) => setNewKeyword(e.target.value)}
                            placeholder="Add new keyword..."
                            className="flex-1 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                            type="submit"
                            disabled={!newKeyword.trim()}
                            className="p-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-md hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        >
                            <Plus size={16} />
                        </button>
                    </form>

                    <p className="mt-4 text-xs text-gray-500 italic">
                        Click a keyword to exclude/include it. Add missing ones manually below.
                    </p>
                </div>
            </div>

            {/* Ana Panel: Outline Editor */}
            <div className="lg:col-span-8 space-y-6">
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">

                    <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gray-50/50 dark:bg-gray-800/30">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <LayoutList className="w-5 h-5 text-blue-600" />
                            Finalize Your Outline
                        </h2>
                        <div className="flex gap-2">
                            <button onClick={() => appendHeading('h2')} className="text-xs font-bold px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 transition-colors">+ Add H2 to Bottom</button>
                        </div>
                    </div>

                    <div className="p-6 space-y-2">
                        {headings.map((heading, index) => (
                            <div
                                key={heading.id}
                                draggable
                                onDragStart={() => handleDragStart(index)}
                                onDragOver={handleDragOver}
                                onDrop={() => handleDrop(index)}
                                className={cn(
                                    "group flex items-center gap-3 p-2 rounded-lg border transition-all bg-white dark:bg-gray-900",
                                    draggedIndex === index ? "opacity-50 border-blue-500 border-dashed" : "border-transparent hover:border-gray-200 dark:hover:border-gray-700",
                                    heading.level === 'h3' ? "ml-8" : "ml-0"
                                )}
                            >
                                <div className="cursor-grab active:cursor-grabbing text-gray-300 group-hover:text-gray-500 transition-colors p-1">
                                    <GripVertical size={18} />
                                </div>

                                <div className="w-8 text-center">
                                    <span className={cn(
                                        "text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded",
                                        heading.level === 'h2' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                    )}>
                                        {heading.level}
                                    </span>
                                </div>

                                <input
                                    type="text"
                                    value={heading.text}
                                    onChange={(e) => updateHeadingText(heading.id, e.target.value)}
                                    placeholder={`Enter ${heading.level} heading...`}
                                    className={cn(
                                        "flex-1 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-blue-500 focus:outline-none py-1 transition-all",
                                        heading.level === 'h2' ? "text-base font-bold text-gray-900 dark:text-white" : "text-sm font-medium text-gray-600 dark:text-gray-300"
                                    )}
                                />

                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                    {heading.level === 'h2' && (
                                        <button onClick={() => insertHeadingBelow(index, 'h3')} title="Add H3 below" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all">
                                            <Plus size={16} />
                                        </button>
                                    )}
                                    {heading.level === 'h3' && (
                                        <button onClick={() => insertHeadingBelow(index, 'h3')} title="Add another H3 below" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all">
                                            <Plus size={16} />
                                        </button>
                                    )}
                                    <button onClick={() => insertHeadingBelow(index, 'h2')} title="Add H2 below" className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-md transition-all">
                                        <LayoutList size={16} />
                                    </button>
                                    <button onClick={() => removeHeading(heading.id)} title="Delete heading" className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all ml-1">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="p-6 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center">
                        <p className="text-xs text-gray-500">
                            <FileText className="inline w-3 h-3 mr-1" />
                            {headings.length} sections will be sent to the AI Writer.
                        </p>
                        <button
                            onClick={handleFinish}
                            className="inline-flex items-center px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl shadow-lg hover:from-blue-700 hover:to-indigo-700 transition-all hover:scale-105"
                        >
                            <Sparkles className="w-4 h-4 mr-2" />
                            Generate Full Article
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}