// apps/web/src/components/generator/ProseEditor.tsx
"use client";

import { useState } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { GeneratedBlock, FinalOutlineData } from "@/types/generator";
import {
    Download, UploadCloud, CheckCircle2, Activity, Target,
    Wand2, ArrowLeftRight, Scissors, Search, Code, Layout, List
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProseEditorProps {
    blocks: GeneratedBlock[];
    outlineData: FinalOutlineData;
}

// Sağ panel sekmeleri için tip
type SidebarTab = 'optimize' | 'research' | 'technical';

export default function ProseEditor({ blocks, outlineData }: ProseEditorProps) {
    const [hasSelection, setHasSelection] = useState(false);
    const [activeTab, setActiveTab] = useState<SidebarTab>('optimize'); // <-- Sekme State'i

    const generateHTMLFromBlocks = () => {
        return blocks.map(block => {
            if (block.type === 'h2') return `<h2>${block.content}</h2>`;
            if (block.type === 'h3') return `<h3>${block.content}</h3>`;
            if (block.type === 'paragraph') return `<p>${block.content}</p>`;
            if (block.type === 'image') {
                return `<img src="https://images.unsplash.com/photo-1661956602116-aa6865609028?auto=format&fit=crop&w=800&q=80" alt="${block.content}" title="Prompt: ${block.content}" />`;
            }
            return '';
        }).join('');
    };

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

    const handleAIAction = (action: string) => {
        if (!editor) return;
        const { from, to } = editor.state.selection;
        const text = editor.state.doc.textBetween(from, to, ' ');

        console.log(`AI Action [${action}] triggered for text: "${text}"`);
        alert(`Python API will ${action} this text:\n\n"${text.substring(0, 50)}..."`);
    };

    if (!editor) return null;

    return (
        <div className="w-full animate-in fade-in zoom-in-95 duration-500">

            {/* Top Action Bar */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-t-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400 font-medium bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-md">
                        {wordCount} words
                    </div>
                    <span className="text-sm font-medium text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-md flex items-center gap-1.5">
                        <CheckCircle2 size={16} /> Saved to Database
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <button className="inline-flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-sm font-bold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <Download size={16} className="mr-2" /> Export
                    </button>
                    <button className="inline-flex items-center px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold rounded-lg shadow-md hover:from-blue-700 hover:to-indigo-700 transition-colors">
                        <UploadCloud size={16} className="mr-2" /> Publish to WP
                    </button>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row border-x border-b border-gray-200 dark:border-gray-800 rounded-b-2xl overflow-hidden bg-gray-50/30 dark:bg-gray-900/50">

                {/* Main Editor Area */}
                <div className="flex-1 p-8 lg:p-12 bg-white dark:bg-[#0B1120] overflow-y-auto max-h-[800px] scroll-smooth relative">

                    {/* Dynamic AI Toolbar (Bubble Menu Alternative) */}
                    {hasSelection && (
                        <div className="sticky top-0 z-10 mb-6 flex items-center gap-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 p-2 rounded-xl shadow-xl animate-in slide-in-from-top-2 fade-in duration-200 w-fit mx-auto">
                            <span className="text-xs font-bold uppercase tracking-widest opacity-50 px-3">AI Editor</span>
                            <div className="w-px h-5 bg-gray-700 dark:bg-gray-300 mx-1"></div>

                            <button onClick={() => handleAIAction('Rewrite')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors rounded-md">
                                <Wand2 size={14} className="text-blue-400 dark:text-blue-600" /> Rewrite
                            </button>
                            <button onClick={() => handleAIAction('Expand')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors rounded-md">
                                <ArrowLeftRight size={14} className="text-green-400 dark:text-green-600" /> Expand
                            </button>
                            <button onClick={() => handleAIAction('Condense')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors rounded-md">
                                <Scissors size={14} className="text-red-400 dark:text-red-600" /> Condense
                            </button>
                        </div>
                    )}

                    <EditorContent editor={editor} />
                </div>

                {/* Right Sidebar: Multi-Tab Analytics */}
                <div className="w-full lg:w-96 bg-gray-50 dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 flex flex-col h-[800px]">

                    {/* Tabs Header */}
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

                    {/* Tab Content Area */}
                    <div className="flex-1 overflow-y-auto p-6">

                        {/* TAB 1: OPTIMIZE (SEO & Keywords) */}
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
                                        {outlineData.selectedKeywords.map((kw, i) => (
                                            <div key={i} className="flex items-center justify-between p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm">
                                                <span className="text-sm text-gray-700 dark:text-gray-300 font-medium truncate pr-2">{kw}</span>
                                                <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                                            </div>
                                        ))}
                                        {outlineData.selectedKeywords.length === 0 && (
                                            <div className="text-sm text-gray-400 italic">No specific keywords targeted.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* TAB 2: RESEARCH (Competitor Outlines) */}
                        {activeTab === 'research' && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
                                    <Layout size={16} className="text-purple-500" /> Competitor Outlines
                                </h3>
                                <p className="text-xs text-gray-500">Reference headings from top-ranking SERP results.</p>

                                {/* Mock Competitor 1 */}
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
                                    <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 truncate">1. SearchEngineJournal</h4>
                                    <ul className="space-y-2">
                                        <li className="text-xs text-gray-600 dark:text-gray-300 flex gap-2"><span className="font-bold text-gray-400">H2</span> What is the Core Concept?</li>
                                        <li className="text-xs text-gray-600 dark:text-gray-300 flex gap-2"><span className="font-bold text-gray-400">H3</span> Key Benefits</li>
                                        <li className="text-xs text-gray-600 dark:text-gray-300 flex gap-2"><span className="font-bold text-gray-400">H2</span> Future Trends</li>
                                    </ul>
                                </div>

                                {/* Mock Competitor 2 */}
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
                                    <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 truncate">2. Hubspot Blog</h4>
                                    <ul className="space-y-2">
                                        <li className="text-xs text-gray-600 dark:text-gray-300 flex gap-2"><span className="font-bold text-gray-400">H2</span> Ultimate Strategy Guide</li>
                                        <li className="text-xs text-gray-600 dark:text-gray-300 flex gap-2"><span className="font-bold text-gray-400">H3</span> Tools You Need</li>
                                    </ul>
                                </div>
                            </div>
                        )}

                        {/* TAB 3: TECHNICAL (Meta & Schema) */}
                        {activeTab === 'technical' && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
                                    <Code size={16} className="text-emerald-500" /> Meta & Schema
                                </h3>

                                <div className="space-y-4">
                                    <div>
                                        <label className="flex justify-between text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                            Meta Title <span className="text-green-500 font-normal">58/60 chars</span>
                                        </label>
                                        <div className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300">
                                            The Ultimate Guide to Generating AI Content in 2026
                                        </div>
                                    </div>

                                    <div>
                                        <label className="flex justify-between text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                            Meta Description <span className="text-green-500 font-normal">145/160 chars</span>
                                        </label>
                                        <div className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300">
                                            Learn how to automate your content strategy using NLP models, dynamic schema generation, and programmatic SEO techniques.
                                        </div>
                                    </div>

                                    <div>
                                        <label className="flex justify-between text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                            JSON-LD Schema
                                        </label>
                                        <div className="p-3 bg-gray-900 text-green-400 font-mono text-xs rounded-lg overflow-x-auto">
                                            <pre>{`{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Generated Content",
  "author": {
    "@type": "Organization",
    "name": "ContentForge"
  }
}`}</pre>
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