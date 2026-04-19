// apps/web/src/components/generator/ProseEditor.tsx
"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import TurndownService from 'turndown';
import DOMPurify from 'isomorphic-dompurify';
import { GeneratedBlock, FinalOutlineData } from "@/types/generator";
import { analyzeContent, analyzeKeywordDensity } from "@/lib/content-analysis";
import { runSeoChecklist } from "@/lib/seo-checklist";
import {
    UploadCloud, CheckCircle2, Activity, Target,
    Wand2, ArrowLeftRight, Scissors, Search, Code, Layout,
    Loader2, AlertCircle, SpellCheck, Copy, ChevronDown,
    ChevronRight, BookOpen, ListChecks, Hash, XCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

// Extraction of editor extensions outside the component lifecycle to prevent 
// React 18 Strict Mode from instantiating duplicate extensions (fixes the "duplicate link" warning).
const globalEditorExtensions = [
    StarterKit,
    Image.configure({ inline: true }),
    Link.configure({ openOnClick: false }),
];

interface ProseEditorProps {
    blocks?: GeneratedBlock[];
    outlineData: FinalOutlineData;
    initialHtml?: string;
    documentId?: string;
}

type SidebarTab = 'optimize' | 'research' | 'technical';

// Reusable Accordion Component for the Right Panel
function AccordionSection({
    title, icon: Icon, badgeCount, defaultOpen = false, children
}: {
    title: string; icon: any; badgeCount?: number | string; defaultOpen?: boolean; children: React.ReactNode
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm transition-all duration-200">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 bg-gray-50/50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
            >
                <div className="flex items-center gap-2.5">
                    <div className="p-1.5 bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                        <Icon size={16} className="text-indigo-500" />
                    </div>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{title}</span>
                </div>
                <div className="flex items-center gap-3">
                    {badgeCount !== undefined && (
                        <span className="text-xs font-bold text-gray-500 bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                            {badgeCount}
                        </span>
                    )}
                    {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                </div>
            </button>
            {isOpen && (
                <div className="p-4 border-t border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800/20">
                    {children}
                </div>
            )}
        </div>
    );
}

export default function ProseEditor({ blocks, outlineData, initialHtml, documentId }: ProseEditorProps) {
    const [hasSelection, setHasSelection] = useState(false);
    const [activeTab, setActiveTab] = useState<SidebarTab>('optimize');
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [isAILoading, setIsAILoading] = useState<boolean>(false);
    const [isPublishing, setIsPublishing] = useState<boolean>(false);
    const [isProofreading, setIsProofreading] = useState<boolean>(false);

    const [currentHtml, setCurrentHtml] = useState<string>("");

    const [seoMeta, setSeoMeta] = useState({
        focusKeyword: "",
        metaTitle: "",
        metaDescription: ""
    });

    const generateHTMLFromBlocks = useCallback(() => {
        if (initialHtml) return DOMPurify.sanitize(initialHtml);
        if (!blocks) return "";

        const rawHtml = blocks.map(block => {
            if (block.type === 'h2' && typeof block.content === 'string') return `<h2>${block.content}</h2>`;
            if (block.type === 'h3' && typeof block.content === 'string') return `<h3>${block.content}</h3>`;
            if (block.type === 'paragraph' && typeof block.content === 'string') return block.content;
            if (block.type === 'image' && typeof block.content === 'string') return block.content;
            return '';
        }).join('');

        return DOMPurify.sanitize(rawHtml);
    }, [blocks, initialHtml]);

    useEffect(() => {
        const fallbackTitle = (outlineData as any).title || outlineData.headings?.[0]?.text || "Generated SEO Article";
        const fallbackDesc = "Optimized document generated by ContentForge AI.";

        if (blocks && blocks.length > 0) {
            const seoBlock = blocks.find(b => b.type === 'seo_metadata');
            if (seoBlock && seoBlock.content) {
                const meta = typeof seoBlock.content === 'string' ? JSON.parse(seoBlock.content) : seoBlock.content;
                setSeoMeta({
                    focusKeyword: meta.focusKeyword || outlineData.selectedKeywords?.[0] || "",
                    metaTitle: meta.metaTitle || fallbackTitle,
                    metaDescription: meta.metaDescription || fallbackDesc
                });
                return;
            }
        }

        setSeoMeta({
            focusKeyword: outlineData.selectedKeywords?.[0] || "",
            metaTitle: fallbackTitle,
            metaDescription: fallbackDesc
        });
    }, [blocks, outlineData]);

    const editor = useEditor({
        extensions: globalEditorExtensions,
        content: generateHTMLFromBlocks(),
        immediatelyRender: false,
        editorProps: {
            attributes: {
                class: 'prose prose-lg prose-blue dark:prose-invert max-w-none focus:outline-none min-h-[500px] p-4',
            },
        },
        onUpdate({ editor }) {
            setCurrentHtml(editor.getHTML());
        },
        onSelectionUpdate({ editor }) {
            setHasSelection(!editor.state.selection.empty);
        },
        onCreate({ editor }) {
            setCurrentHtml(editor.getHTML());
        }
    });

    // Zero API Cost Analytics Memoization
    const contentStats = useMemo(() => analyzeContent(currentHtml), [currentHtml]);

    const checklist = useMemo(() => runSeoChecklist(currentHtml, seoMeta), [currentHtml, seoMeta]);
    const checklistScore = checklist.filter(c => c.pass).length;

    const keywordDensity = useMemo(() => {
        const keywordsToTrack = Array.from(new Set([
            seoMeta.focusKeyword,
            ...(outlineData.selectedKeywords || [])
        ])).filter(k => k.trim().length > 0);
        return analyzeKeywordDensity(currentHtml, keywordsToTrack);
    }, [currentHtml, seoMeta.focusKeyword, outlineData.selectedKeywords]);

    useEffect(() => {
        let isMounted = true;

        const saveToDatabase = async () => {
            if (documentId) {
                if (isMounted) setSaveStatus('saved');
                return;
            }
            if (!blocks || blocks.length === 0) return;

            try {
                setSaveStatus('saving');
                const htmlContent = generateHTMLFromBlocks();

                const response = await fetch('/api/documents/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: seoMeta.metaTitle || "Untitled Draft",
                        content: htmlContent,
                        aiModel: "CLAUDE_3_5_SONNET",
                        inputData: outlineData,
                        seoMetadata: seoMeta
                    })
                });

                if (!response.ok) throw new Error("Database serialization failed.");
                if (isMounted) setSaveStatus('saved');

            } catch (error) {
                console.error("[DB_SYNC_ERROR]:", error);
                if (isMounted) setSaveStatus('error');
            }
        };

        saveToDatabase();
        return () => { isMounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seoMeta.metaTitle]);

    const handleExportMarkdown = async () => {
        if (!editor) return;
        try {
            const html = editor.getHTML();
            const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
            const markdown = turndownService.turndown(html);
            await navigator.clipboard.writeText(markdown);
            alert("Success: Document architecture copied to clipboard as Markdown.");
        } catch (error) {
            console.error("[CLIPBOARD_ACCESS_FAULT]:", error);
            alert("Clipboard access denied. Please verify your browser permissions.");
        }
    };

    const handleAIAction = async (action: 'Rewrite' | 'Expand' | 'Condense') => {
        if (!editor || isAILoading) return;
        const { from, to } = editor.state.selection;
        const text = editor.state.doc.textBetween(from, to, ' ');
        if (!text.trim()) return;

        try {
            setIsAILoading(true);
            const response = await fetch('/api/generate/edit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, text, context: seoMeta.metaTitle })
            });

            if (!response.ok) throw new Error("The NLP transformation pipeline failed.");
            const data = await response.json();
            const sanitizedHtml = DOMPurify.sanitize(data.result);
            editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, sanitizedHtml).run();
        } catch (error: any) {
            console.error("[EDITOR_AI_FAULT]:", error);
            alert(`Execution halted: ${error.message}`);
        } finally {
            setIsAILoading(false);
            setHasSelection(false);
        }
    };

    const handleProofread = async () => {
        if (!editor || isProofreading) return;
        try {
            setIsProofreading(true);
            const htmlToProof = editor.getHTML();
            const response = await fetch('/api/generate/proofread', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    htmlContent: htmlToProof,
                    language: (outlineData as any).config?.language || "English (US)"
                })
            });

            if (!response.ok) throw new Error("Proofreading service unavailable.");
            const data = await response.json();
            editor.commands.setContent(DOMPurify.sanitize(data.result));
            alert("Success: Document optimized.");
        } catch (error: any) {
            console.error("[PROOFREAD_EXECUTION_FAULT]:", error);
            alert(`Proofreading Failed: ${error.message}`);
        } finally {
            setIsProofreading(false);
        }
    };

    const handleWPPublish = async () => {
        if (!editor || isPublishing) return;
        try {
            setIsPublishing(true);
            const response = await fetch('/api/documents/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: seoMeta.metaTitle,
                    content: editor.getHTML(),
                    seoMetadata: seoMeta
                })
            });

            if (!response.ok) throw new Error("WordPress integration failed.");
            const data = await response.json();
            alert(`Transmission Successful: Deployed to WordPress. Post ID: ${data.postId}`);
        } catch (error: any) {
            console.error("[WP_TRANSMISSION_FAULT]:", error);
            alert(`WordPress Integration Error: ${error.message}`);
        } finally {
            setIsPublishing(false);
        }
    };

    if (!editor) return null;

    return (
        <div className="w-full animate-in fade-in zoom-in-95 duration-500">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-t-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400 font-medium bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-md flex items-center gap-2">
                        <BookOpen size={16} className="text-gray-400" />
                        {contentStats.wordCount} words
                    </div>

                    {saveStatus === 'saving' && (
                        <span className="text-sm font-medium text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-md flex items-center gap-1.5">
                            <Loader2 size={16} className="animate-spin" /> Syncing cluster...
                        </span>
                    )}
                    {saveStatus === 'saved' && (
                        <span className="text-sm font-medium text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-md flex items-center gap-1.5">
                            <CheckCircle2 size={16} /> Secured in vault
                        </span>
                    )}
                    {saveStatus === 'error' && (
                        <span className="text-sm font-medium text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded-md flex items-center gap-1.5">
                            <AlertCircle size={16} /> Sync fractured
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleProofread}
                        disabled={isProofreading}
                        className={cn(
                            "inline-flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-sm font-bold rounded-lg transition-colors",
                            isProofreading ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50 dark:hover:bg-gray-700"
                        )}
                    >
                        {isProofreading ? <><Loader2 size={16} className="mr-2 animate-spin" /> Analyzing...</> : <><SpellCheck size={16} className="mr-2 text-indigo-500" /> Proofread</>}
                    </button>

                    <button
                        onClick={handleExportMarkdown}
                        className="inline-flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-sm font-bold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                        <Copy size={16} className="mr-2" /> Copy as MD
                    </button>

                    <button
                        onClick={handleWPPublish}
                        disabled={isPublishing}
                        className={cn(
                            "inline-flex items-center px-5 py-2 text-white text-sm font-bold rounded-lg shadow-md transition-all",
                            isPublishing ? "bg-gray-400 cursor-not-allowed" : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 hover:scale-[1.02]"
                        )}
                    >
                        {isPublishing ? <><Loader2 size={16} className="mr-2 animate-spin" /> Transmitting...</> : <><UploadCloud size={16} className="mr-2" /> Publish to WP</>}
                    </button>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row border-x border-b border-gray-200 dark:border-gray-800 rounded-b-2xl overflow-hidden bg-gray-50/30 dark:bg-gray-900/50">
                <div className="flex-1 p-8 lg:p-12 bg-white dark:bg-[#0B1120] overflow-y-auto max-h-[800px] scroll-smooth relative">
                    {hasSelection && (
                        <div className="sticky top-0 z-10 mb-6 flex items-center gap-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 p-2 rounded-xl shadow-xl animate-in slide-in-from-top-2 fade-in duration-200 w-fit mx-auto transition-opacity">
                            <span className="text-xs font-bold uppercase tracking-widest opacity-50 px-3">AI Engine</span>
                            <div className="w-px h-5 bg-gray-700 dark:bg-gray-300 mx-1"></div>
                            {isAILoading ? (
                                <div className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-blue-400"><Loader2 size={14} className="animate-spin" /> Processing matrix...</div>
                            ) : (
                                <>
                                    <button onClick={() => handleAIAction('Rewrite')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors rounded-md"><Wand2 size={14} className="text-blue-400 dark:text-blue-600" /> Rewrite</button>
                                    <button onClick={() => handleAIAction('Expand')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors rounded-md"><ArrowLeftRight size={14} className="text-green-400 dark:text-green-600" /> Expand</button>
                                    <button onClick={() => handleAIAction('Condense')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors rounded-md"><Scissors size={14} className="text-red-400 dark:text-red-600" /> Condense</button>
                                </>
                            )}
                        </div>
                    )}
                    <EditorContent editor={editor} />
                </div>

                <div className="w-full lg:w-[420px] bg-gray-50 dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 flex flex-col h-[800px]">
                    <div className="flex items-center border-b border-gray-200 dark:border-gray-800 p-2 gap-1 bg-white dark:bg-gray-900">
                        <button onClick={() => setActiveTab('optimize')} className={cn("flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-md transition-colors", activeTab === 'optimize' ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50")}><Activity size={14} /> Optimize</button>
                        <button onClick={() => setActiveTab('research')} className={cn("flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-md transition-colors", activeTab === 'research' ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50")}><Search size={14} /> Research</button>
                        <button onClick={() => setActiveTab('technical')} className={cn("flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-md transition-colors", activeTab === 'technical' ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50")}><Code size={14} /> Technical</button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {activeTab === 'optimize' && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">

                                {/* 1. Readability & Content Stats */}
                                <AccordionSection title="Readability" icon={BookOpen} badgeCount={`${contentStats.readingTime} min`} defaultOpen={true}>
                                    <div className="space-y-4">
                                        <div>
                                            <div className="flex justify-between text-sm mb-1">
                                                <span className="text-gray-600 dark:text-gray-400 font-medium">Flesch Reading Ease</span>
                                                <span className="text-gray-900 dark:text-white font-bold">{contentStats.fleschScore} ({contentStats.fleschLabel})</span>
                                            </div>
                                            <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                                <div className={cn("h-full rounded-full transition-all duration-500", contentStats.fleschColor)} style={{ width: `${contentStats.fleschScore}%` }}></div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                            <div className="bg-gray-50 dark:bg-gray-900 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800">
                                                <div className="text-gray-500 dark:text-gray-400 text-xs mb-1">Words</div>
                                                <div className="font-bold text-gray-900 dark:text-white">{contentStats.wordCount}</div>
                                            </div>
                                            <div className="bg-gray-50 dark:bg-gray-900 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800">
                                                <div className="text-gray-500 dark:text-gray-400 text-xs mb-1">Characters</div>
                                                <div className="font-bold text-gray-900 dark:text-white">{contentStats.charCount}</div>
                                            </div>
                                            <div className="bg-gray-50 dark:bg-gray-900 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800">
                                                <div className="text-gray-500 dark:text-gray-400 text-xs mb-1">Avg. Sentence</div>
                                                <div className="font-bold text-gray-900 dark:text-white">{Math.round(contentStats.sentenceLength)} words</div>
                                            </div>
                                            <div className="bg-gray-50 dark:bg-gray-900 p-2.5 rounded-lg border border-gray-100 dark:border-gray-800">
                                                <div className="text-gray-500 dark:text-gray-400 text-xs mb-1">Structure</div>
                                                <div className="font-bold text-gray-900 dark:text-white">{contentStats.h2Count} H2 / {contentStats.h3Count} H3</div>
                                            </div>
                                        </div>

                                        <div className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-700/50 flex justify-between">
                                            <span>Links: {contentStats.internalLinks} In / {contentStats.externalLinks} Out</span>
                                            <span>Media: {contentStats.imageCount} Img / {contentStats.tableCount} Tbl</span>
                                        </div>
                                    </div>
                                </AccordionSection>

                                {/* 2. SEO Checklist */}
                                <AccordionSection title="SEO Checklist" icon={ListChecks} badgeCount={`${checklistScore}/10`} defaultOpen={false}>
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Optimization Score</span>
                                            <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold border-2"
                                                style={{ borderColor: checklistScore >= 8 ? '#22c55e' : checklistScore >= 5 ? '#eab308' : '#ef4444', color: checklistScore >= 8 ? '#22c55e' : checklistScore >= 5 ? '#eab308' : '#ef4444' }}>
                                                {checklistScore}
                                            </div>
                                        </div>
                                        {checklist.map((item) => (
                                            <details key={item.id} className="group bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 [&_summary::-webkit-details-marker]:hidden">
                                                <summary className="flex items-center justify-between p-2.5 cursor-pointer list-none">
                                                    <div className="flex items-center gap-2.5">
                                                        {item.pass ? <CheckCircle2 size={16} className="text-green-500" /> : <XCircle size={16} className="text-red-500" />}
                                                        <span className={cn("text-sm font-medium", item.pass ? "text-gray-900 dark:text-gray-200" : "text-gray-600 dark:text-gray-400")}>{item.label}</span>
                                                    </div>
                                                    <ChevronDown size={14} className="text-gray-400 group-open:rotate-180 transition-transform" />
                                                </summary>
                                                <div className="p-3 pt-0 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800 mt-1">
                                                    {item.tip}
                                                </div>
                                            </details>
                                        ))}
                                    </div>
                                </AccordionSection>

                                {/* 3. Keyword Density Breakdown */}
                                <AccordionSection title="Keyword Density" icon={Hash} badgeCount={keywordDensity.length} defaultOpen={false}>
                                    <div className="space-y-2">
                                        {keywordDensity.map((kd, idx) => (
                                            <div key={idx} className="bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-3">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-sm font-bold text-gray-900 dark:text-white truncate pr-2">{kd.keyword}</span>
                                                    <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap",
                                                        kd.densityStatus === 'optimal' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                                                            kd.densityStatus === 'high' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                                                "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                                    )}>
                                                        {kd.densityLabel}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                                                    <span>{kd.occurrences} matches</span>
                                                    <div className="flex gap-2">
                                                        <span title="Appears in first paragraph" className={kd.inFirstParagraph ? "text-blue-500" : "opacity-30"}>📄</span>
                                                        <span title="Appears in headings" className={kd.inAnyHeading ? "text-indigo-500" : "opacity-30"}>📌</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {keywordDensity.length === 0 && (
                                            <p className="text-xs text-gray-500 text-center py-4">No keywords analyzed yet.</p>
                                        )}
                                    </div>
                                </AccordionSection>

                            </div>
                        )}

                        {activeTab === 'research' && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider"><Layout size={16} className="text-purple-500" /> Source URLs Utilized</h3>
                                <div className="space-y-3">
                                    {outlineData.sourceUrls?.map((url: string, index: number) => (
                                        <div key={index} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                                            <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all">{url}</a>
                                        </div>
                                    ))}
                                    {(!outlineData.sourceUrls || outlineData.sourceUrls.length === 0) && (
                                        <p className="text-xs text-gray-500 italic">No external sources utilized for this document.</p>
                                    )}
                                </div>
                            </div>
                        )}
                        {activeTab === 'technical' && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider"><Code size={16} className="text-emerald-500" /> Rank Math Meta & Schema</h3>
                                <div className="space-y-5 mt-4">
                                    <div>
                                        <label className="flex justify-between text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                            Focus Keyword
                                        </label>
                                        <input
                                            type="text"
                                            value={seoMeta.focusKeyword}
                                            onChange={(e) => setSeoMeta({ ...seoMeta, focusKeyword: e.target.value })}
                                            className="w-full p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                            placeholder="Target SEO keyword..."
                                        />
                                    </div>
                                    <div>
                                        <label className="flex justify-between text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                            Meta Title
                                            <span className={cn("font-normal", seoMeta.metaTitle.length > 60 ? "text-red-500" : "text-green-500")}>
                                                {seoMeta.metaTitle.length}/60 chars
                                            </span>
                                        </label>
                                        <input
                                            type="text"
                                            value={seoMeta.metaTitle}
                                            onChange={(e) => setSeoMeta({ ...seoMeta, metaTitle: e.target.value })}
                                            className="w-full p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                            placeholder="Catchy meta title..."
                                        />
                                    </div>
                                    <div>
                                        <label className="flex justify-between text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                            Meta Description
                                            <span className={cn("font-normal", seoMeta.metaDescription.length > 160 ? "text-red-500" : "text-green-500")}>
                                                {seoMeta.metaDescription.length}/160 chars
                                            </span>
                                        </label>
                                        <textarea
                                            rows={5}
                                            value={seoMeta.metaDescription}
                                            onChange={(e) => setSeoMeta({ ...seoMeta, metaDescription: e.target.value })}
                                            className="w-full p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none"
                                            placeholder="Engaging meta description..."
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}