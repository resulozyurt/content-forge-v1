// apps/web/src/components/generator/ProseEditor.tsx
"use client";

import { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { GeneratedBlock, FinalOutlineData } from "@/types/generator";
import {
    Download, UploadCloud, CheckCircle2, Activity, Target,
    Wand2, ArrowLeftRight, Scissors, Search, Code, Layout,
    Loader2, AlertCircle, SpellCheck
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProseEditorProps {
    blocks: GeneratedBlock[];
    outlineData: FinalOutlineData;
}

type SidebarTab = 'optimize' | 'research' | 'technical';

export default function ProseEditor({ blocks, outlineData }: ProseEditorProps) {
    const [hasSelection, setHasSelection] = useState(false);
    const [activeTab, setActiveTab] = useState<SidebarTab>('optimize');
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [isAILoading, setIsAILoading] = useState<boolean>(false);
    const [isPublishing, setIsPublishing] = useState<boolean>(false);
    const [isProofreading, setIsProofreading] = useState<boolean>(false);

    // Reconstruct valid HTML from the generated blocks
    const generateHTMLFromBlocks = () => {
        return blocks.map(block => {
            if (block.type === 'h2') return `<h2>${block.content}</h2>`;
            if (block.type === 'h3') return `<h3>${block.content}</h3>`;
            if (block.type === 'paragraph') return `<p>${block.content}</p>`;
            if (block.type === 'image') return block.content;
            return '';
        }).join('');
    };

    // Dynamic extraction for SEO meta tags
    const metaTitle = outlineData.headings?.[0]?.text || "Generated AI Article";
    const firstParagraph = blocks.find(b => b.type === 'paragraph')?.content?.replace(/<[^>]*>?/gm, '') || "";
    const metaDescription = firstParagraph.substring(0, 155) + "...";

    const editor = useEditor({
        extensions: [
            StarterKit,
            Image.configure({ inline: true }),
            Link.configure({ openOnClick: false }),
        ],
        content: generateHTMLFromBlocks(),
        immediatelyRender: false,
        editorProps: {
            attributes: {
                class: 'prose prose-lg prose-blue dark:prose-invert max-w-none focus:outline-none min-h-[500px]',
            },
        },
        onSelectionUpdate({ editor }) {
            setHasSelection(!editor.state.selection.empty);
        },
    });

    const wordCount = editor?.getText().split(/\s+/).filter(word => word.length > 0).length || 0;

    // Automated initial synchronization with the database
    useEffect(() => {
        let isMounted = true;

        const saveToDatabase = async () => {
            if (blocks.length === 0) return;

            try {
                setSaveStatus('saving');
                const htmlContent = generateHTMLFromBlocks();

                const response = await fetch('/api/documents/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: metaTitle,
                        content: htmlContent,
                        aiModel: "Claude",
                        inputData: outlineData
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
    }, []);

    // Intercepts user selection and routes it to the inline AI modification pipeline
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
                body: JSON.stringify({
                    action,
                    text,
                    context: metaTitle
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || "The NLP transformation pipeline failed.");
            }

            const data = await response.json();
            editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, data.result).run();

        } catch (error: any) {
            console.error("[EDITOR_AI_FAULT]:", error);
            alert(`Execution halted: ${error.message}`);
        } finally {
            setIsAILoading(false);
            setHasSelection(false);
        }
    };

    // Executes the full-document proofreading sequence
    const handleProofread = async () => {
        if (!editor || isProofreading) return;

        try {
            setIsProofreading(true);
            const currentHTML = editor.getHTML();

            const response = await fetch('/api/generate/proofread', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    htmlContent: currentHTML,
                    language: "English (US)" // This could be wired to a dynamic config state later
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || "The proofreading pipeline failed.");
            }

            const data = await response.json();

            // Atomically replace the entire canvas content with the refined output
            editor.commands.setContent(data.result);

        } catch (error: any) {
            console.error("[PROOFREAD_FAULT]:", error);
            alert(`Proofreading execution halted: ${error.message}`);
        } finally {
            setIsProofreading(false);
        }
    };

    // Executes the transmission to the connected WordPress environment
    const handleWPPublish = async () => {
        if (!editor || isPublishing) return;

        try {
            setIsPublishing(true);
            const htmlContent = editor.getHTML();

            const response = await fetch('/api/documents/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: metaTitle,
                    content: htmlContent
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Transmission to WordPress failed.");
            }

            alert(`Success! Article successfully pushed to WordPress as a draft.\nPost ID: ${data.postId}`);

        } catch (error: any) {
            console.error("[WP_TRANSMISSION_FAULT]:", error);
            alert(`Publishing failed: ${error.message}`);
        } finally {
            setIsPublishing(false);
        }
    };

    if (!editor) return null;

    return (
        <div className="w-full animate-in fade-in zoom-in-95 duration-500">

            {/* Application Toolbar */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-t-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400 font-medium bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-md">
                        {wordCount} words
                    </div>

                    {/* Persistence Telemetry */}
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
                    {/* Grammar Check / Proofread Button */}
                    <button
                        onClick={handleProofread}
                        disabled={isProofreading}
                        className={cn(
                            "inline-flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-sm font-bold rounded-lg transition-colors",
                            isProofreading ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50 dark:hover:bg-gray-700"
                        )}
                    >
                        {isProofreading ? (
                            <><Loader2 size={16} className="mr-2 animate-spin" /> Analyzing...</>
                        ) : (
                            <><SpellCheck size={16} className="mr-2 text-indigo-500" /> Proofread</>
                        )}
                    </button>

                    <button className="inline-flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-sm font-bold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <Download size={16} className="mr-2" /> Export
                    </button>
                    <button
                        onClick={handleWPPublish}
                        disabled={isPublishing}
                        className={cn(
                            "inline-flex items-center px-5 py-2 text-white text-sm font-bold rounded-lg shadow-md transition-all",
                            isPublishing
                                ? "bg-gray-400 cursor-not-allowed"
                                : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 hover:scale-[1.02]"
                        )}
                    >
                        {isPublishing ? (
                            <><Loader2 size={16} className="mr-2 animate-spin" /> Transmitting...</>
                        ) : (
                            <><UploadCloud size={16} className="mr-2" /> Publish to WP</>
                        )}
                    </button>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row border-x border-b border-gray-200 dark:border-gray-800 rounded-b-2xl overflow-hidden bg-gray-50/30 dark:bg-gray-900/50">

                {/* Primary Canvas */}
                <div className="flex-1 p-8 lg:p-12 bg-white dark:bg-[#0B1120] overflow-y-auto max-h-[800px] scroll-smooth relative">

                    {/* Contextual AI Command Palette */}
                    {hasSelection && (
                        <div className="sticky top-0 z-10 mb-6 flex items-center gap-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 p-2 rounded-xl shadow-xl animate-in slide-in-from-top-2 fade-in duration-200 w-fit mx-auto transition-opacity">
                            <span className="text-xs font-bold uppercase tracking-widest opacity-50 px-3">AI Engine</span>
                            <div className="w-px h-5 bg-gray-700 dark:bg-gray-300 mx-1"></div>

                            {isAILoading ? (
                                <div className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-blue-400">
                                    <Loader2 size={14} className="animate-spin" /> Processing matrix...
                                </div>
                            ) : (
                                <>
                                    <button onClick={() => handleAIAction('Rewrite')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors rounded-md">
                                        <Wand2 size={14} className="text-blue-400 dark:text-blue-600" /> Rewrite
                                    </button>
                                    <button onClick={() => handleAIAction('Expand')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors rounded-md">
                                        <ArrowLeftRight size={14} className="text-green-400 dark:text-green-600" /> Expand
                                    </button>
                                    <button onClick={() => handleAIAction('Condense')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors rounded-md">
                                        <Scissors size={14} className="text-red-400 dark:text-red-600" /> Condense
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* Render visual loading overlay during full document proofreading */}
                    {isProofreading && (
                        <div className="absolute inset-0 z-20 bg-white/60 dark:bg-gray-900/60 backdrop-blur-[1px] flex flex-col items-center justify-center animate-in fade-in">
                            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-xl flex flex-col items-center">
                                <Loader2 size={32} className="text-indigo-600 animate-spin mb-4" />
                                <p className="font-bold text-gray-900 dark:text-white">Analyzing Document Structure</p>
                                <p className="text-sm text-gray-500 mt-1">Applying advanced linguistic and grammar corrections...</p>
                            </div>
                        </div>
                    )}

                    <EditorContent editor={editor} />
                </div>

                {/* Telemetry Sidebar */}
                <div className="w-full lg:w-96 bg-gray-50 dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 flex flex-col h-[800px]">
                    <div className="flex items-center border-b border-gray-200 dark:border-gray-800 p-2 gap-1 bg-white dark:bg-gray-900">
                        <button
                            onClick={() => setActiveTab('optimize')}
                            className={cn("flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-md transition-colors", activeTab === 'optimize' ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50")}
                        >
                            <Activity size={14} /> Optimize
                        </button>
                        <button
                            onClick={() => setActiveTab('research')}
                            className={cn("flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-md transition-colors", activeTab === 'research' ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50")}
                        >
                            <Search size={14} /> Research
                        </button>
                        <button
                            onClick={() => setActiveTab('technical')}
                            className={cn("flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-md transition-colors", activeTab === 'technical' ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50")}
                        >
                            <Code size={14} /> Technical
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6">
                        {activeTab === 'optimize' && (
                            <div className="space-y-8 animate-in fade-in slide-in-from-right-2 duration-300">
                                <div className="space-y-4">
                                    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
                                        <Activity size={16} className="text-blue-500" /> Quality Scores
                                    </h3>
                                    <div className="space-y-3">
                                        <div>
                                            <div className="flex justify-between text-sm mb-1"><span className="text-gray-600 dark:text-gray-400 font-medium">SEO Coverage</span><span className="text-gray-900 dark:text-white font-bold">85/100</span></div>
                                            <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"><div className="h-full bg-blue-500 w-[85%] rounded-full"></div></div>
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-sm mb-1"><span className="text-gray-600 dark:text-gray-400 font-medium">Structure</span><span className="text-gray-900 dark:text-white font-bold">18/20</span></div>
                                            <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"><div className="h-full bg-green-500 w-[90%] rounded-full"></div></div>
                                        </div>
                                    </div>
                                </div>
                                <hr className="border-gray-200 dark:border-gray-800" />
                                <div className="space-y-4">
                                    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
                                        <Target size={16} className="text-orange-500" /> Keyword Tracking
                                    </h3>
                                    <div className="space-y-2">
                                        {outlineData.selectedKeywords?.map((kw, i) => (
                                            <div key={i} className="flex items-center justify-between p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
                                                <span className="text-sm text-gray-700 dark:text-gray-300 font-medium truncate pr-2">{kw}</span>
                                                <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'research' && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
                                    <Layout size={16} className="text-purple-500" /> Source URLs Utilized
                                </h3>
                                <div className="space-y-3">
                                    {outlineData.sourceUrls?.map((url: string, index: number) => (
                                        <div key={index} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                                            <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all">
                                                {url}
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'technical' && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
                                    <Code size={16} className="text-emerald-500" /> Meta & Schema
                                </h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="flex justify-between text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                            Meta Title <span className="text-green-500 font-normal">{metaTitle.length}/60 chars</span>
                                        </label>
                                        <div className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300">
                                            {metaTitle}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="flex justify-between text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                            Meta Description <span className="text-green-500 font-normal">{metaDescription.length}/160 chars</span>
                                        </label>
                                        <div className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300">
                                            {metaDescription}
                                        </div>
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