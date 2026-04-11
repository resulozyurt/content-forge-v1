// apps/web/src/components/generator/ProseEditor.tsx
"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { GeneratedBlock, FinalOutlineData } from "@/types/generator";
import { Download, UploadCloud, CheckCircle2, Activity, Target } from "lucide-react";

interface ProseEditorProps {
    blocks: GeneratedBlock[];
    outlineData: FinalOutlineData;
}

export default function ProseEditor({ blocks, outlineData }: ProseEditorProps) {

    // Convert generated AI blocks into HTML format for the editor
    const generateHTMLFromBlocks = () => {
        return blocks.map(block => {
            if (block.type === 'h2') return `<h2>${block.content}</h2>`;
            if (block.type === 'h3') return `<h3>${block.content}</h3>`;
            if (block.type === 'paragraph') return `<p>${block.content}</p>`;
            if (block.type === 'image') {
                // Image placeholder for the AI generated image prompt
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
        immediatelyRender: false, // <-- FIX: Prevents Next.js SSR hydration mismatch
        editorProps: {
            attributes: {
                class: 'prose prose-lg dark:prose-invert max-w-none focus:outline-none min-h-[500px]',
            },
        },
    });

    const wordCount = editor?.getText().split(/\s+/).filter(word => word.length > 0).length || 0;

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
                        <Download size={16} className="mr-2" /> Export Markdown
                    </button>
                    <button className="inline-flex items-center px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold rounded-lg shadow-md hover:from-blue-700 hover:to-indigo-700 transition-colors">
                        <UploadCloud size={16} className="mr-2" /> Publish to WordPress
                    </button>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row border-x border-b border-gray-200 dark:border-gray-800 rounded-b-2xl overflow-hidden bg-gray-50/30 dark:bg-gray-900/50">

                {/* Main Editor Area (ProseMirror/Tiptap) */}
                <div className="flex-1 p-8 lg:p-12 bg-white dark:bg-[#0B1120] overflow-y-auto max-h-[800px] scroll-smooth">
                    <EditorContent editor={editor} />
                </div>

                {/* Right Sidebar: SEO & Quality Scores */}
                <div className="w-full lg:w-80 bg-gray-50 dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 p-6 flex flex-col gap-6 overflow-y-auto max-h-[800px]">

                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
                            <Activity size={16} className="text-blue-500" /> Quality Scores
                        </h3>

                        <div className="space-y-3">
                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-gray-600 dark:text-gray-400 font-medium">SEO Coverage</span>
                                    <span className="text-gray-900 dark:text-white font-bold">85/100</span>
                                </div>
                                <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-blue-500 w-[85%] rounded-full"></div>
                                </div>
                            </div>

                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-gray-600 dark:text-gray-400 font-medium">Structure</span>
                                    <span className="text-gray-900 dark:text-white font-bold">18/20</span>
                                </div>
                                <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-green-500 w-[90%] rounded-full"></div>
                                </div>
                            </div>

                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-gray-600 dark:text-gray-400 font-medium">Readability</span>
                                    <span className="text-gray-900 dark:text-white font-bold">20/20</span>
                                </div>
                                <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-indigo-500 w-full rounded-full"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <hr className="border-gray-200 dark:border-gray-800" />

                    <div className="space-y-4">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
                            <Target size={16} className="text-orange-500" /> Keyword Tracking
                        </h3>
                        <p className="text-xs text-gray-500 mb-2">Target keywords generated by the AI in the text.</p>

                        <div className="space-y-2">
                            {outlineData.selectedKeywords.map((kw, i) => (
                                <div key={i} className="flex items-center justify-between p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
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
            </div>
        </div>
    );
}