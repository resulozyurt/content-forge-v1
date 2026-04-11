// apps/web/src/components/generator/OutlineBuilder.tsx
"use client";

import { useState, useEffect } from "react";
import { ListTree, Plus, Trash2, ArrowUp, ArrowDown, FileText, CheckCircle2, ChevronRight, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResearchResultData, FinalOutlineData } from "@/types/generator";

interface OutlineBuilderProps {
    researchData: ResearchResultData;
    onGenerateArticle: (data: FinalOutlineData) => void;
}

interface HeadingItem {
    id: string;
    level: 'h2' | 'h3';
    text: string;
}

export default function OutlineBuilder({ researchData, onGenerateArticle }: OutlineBuilderProps) {
    const [myOutline, setMyOutline] = useState<HeadingItem[]>([]);
    const [customHeading, setCustomHeading] = useState("");
    const [customLevel, setCustomLevel] = useState<'h2' | 'h3'>('h2');

    // Başlangıçta yapay zekanın (Research'ten gelen) ilk rakibin başlıklarını şablon olarak eklemesi
    useEffect(() => {
        if (researchData?.competitors?.length > 0 && myOutline.length === 0) {
            const firstCompetitor = researchData.competitors.find(c => c.selected);
            if (firstCompetitor && firstCompetitor.headings) {
                const initialHeadings = firstCompetitor.headings.map((h: any, i: number) => ({
                    id: `init-${i}`,
                    level: h.level,
                    text: h.text
                }));
                setMyOutline(initialHeadings);
            }
        }
    }, [researchData]);

    const handleAddFromCompetitor = (heading: { level: string, text: string }) => {
        setMyOutline(prev => [...prev, {
            id: `comp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            level: heading.level as 'h2' | 'h3',
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

    const handleMove = (index: number, direction: 'up' | 'down') => {
        if (direction === 'up' && index === 0) return;
        if (direction === 'down' && index === myOutline.length - 1) return;

        const newOutline = [...myOutline];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;

        // Elemanların yerini değiştir (Swap)
        [newOutline[index], newOutline[targetIndex]] = [newOutline[targetIndex], newOutline[index]];
        setMyOutline(newOutline);
    };

    const handleFinalize = () => {
        if (myOutline.length === 0) {
            alert("Please add at least one heading to your outline.");
            return;
        }

        // Seçili keywordleri ayıkla
        const selectedKeywords = researchData.keywords
            ? researchData.keywords.filter((kw: any) => kw.selected).map((kw: any) => kw.text)
            : [];

        const finalData: FinalOutlineData = {
            headings: myOutline.map(h => ({ level: h.level, text: h.text })),
            selectedKeywords: selectedKeywords,
        };

        onGenerateArticle(finalData);
    };

    return (
        <div className="w-full max-w-6xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-500">

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <ListTree className="w-6 h-6 text-indigo-500" />
                        Outline Builder
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Craft your article's structure. Click competitor headings to add them, or create your own.
                    </p>
                </div>
                <div className="flex items-center gap-3 bg-indigo-50 dark:bg-indigo-900/20 px-4 py-2 rounded-lg border border-indigo-100 dark:border-indigo-800/50">
                    <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400">Total Headings:</span>
                    <span className="text-xl font-black text-indigo-600 dark:text-indigo-300">{myOutline.length}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* SOL PANEL: Competitor Headings (Havuz) */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm flex flex-col h-[700px]">
                    <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                        <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <FileText className="w-5 h-5 text-blue-500" />
                            SERP Inspiration
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

                {/* SAĞ PANEL: My Article Outline (Hedef) */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm flex flex-col h-[700px]">
                    <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex justify-between items-center">
                        <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Wand2 className="w-5 h-5 text-green-500" />
                            Your Article Structure
                        </h3>
                    </div>

                    {/* Custom Heading Form */}
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
                                placeholder="Add custom heading..."
                                className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button type="submit" disabled={!customHeading.trim()} className="px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold rounded-lg disabled:opacity-50 hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors">
                                Add
                            </button>
                        </form>
                    </div>

                    {/* Sortable List */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50/50 dark:bg-gray-900/50">
                        {myOutline.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-3">
                                <ListTree className="w-12 h-12 opacity-20" />
                                <p className="text-sm">Your outline is empty. Click headings on the left to add them.</p>
                            </div>
                        ) : (
                            myOutline.map((item, index) => (
                                <div
                                    key={item.id}
                                    className="flex items-center gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3 rounded-xl shadow-sm hover:border-blue-300 dark:hover:border-blue-700 transition-colors group"
                                >
                                    <div className="flex flex-col gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleMove(index, 'up')} disabled={index === 0} className="hover:text-blue-500 disabled:opacity-30"><ArrowUp size={14} /></button>
                                        <button onClick={() => handleMove(index, 'down')} disabled={index === myOutline.length - 1} className="hover:text-blue-500 disabled:opacity-30"><ArrowDown size={14} /></button>
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
                                        onClick={() => handleRemove(item.id)}
                                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Footer Action */}
                    <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
                        <button
                            onClick={handleFinalize}
                            disabled={myOutline.length === 0}
                            className="w-full flex items-center justify-center py-3.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold rounded-xl shadow-md hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 transition-all hover:scale-[1.02]"
                        >
                            <CheckCircle2 className="w-5 h-5 mr-2" />
                            Confirm Outline & Generate Article
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}