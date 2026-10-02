// apps/web/src/components/generator/ProseEditor.tsx
"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
// RAILWAY BUILD FIX: `Extension` comes via @tiptap/react (which re-exports all
// of @tiptap/core) — @tiptap/core is NOT a direct dependency and pnpm's strict
// node_modules refuses transitive imports ("Module not found: @tiptap/core").
import { useEditor, EditorContent, Extension } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table/table';
import { TableRow } from '@tiptap/extension-table/row';
import { TableCell } from '@tiptap/extension-table/cell';
import { TableHeader } from '@tiptap/extension-table/header';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import TurndownService from 'turndown';
import DOMPurify from 'isomorphic-dompurify';
import { GeneratedBlock, FinalOutlineData } from "@/types/generator";
import { analyzeContent, analyzeKeywordDensity } from "@/lib/content-analysis";
import { analyzeReadability, readabilityMinScore, scoreImprovementCheck, type ReadabilityCheck } from "@/lib/readability";
import { runSeoChecklist } from "@/lib/seo-checklist";
import { useRef } from 'react';

import {
    UploadCloud, CheckCircle2, Activity,
    Search, Code, Layout,
    Loader2, AlertCircle, SpellCheck, ChevronDown,
    ChevronRight, BookOpen, ListChecks, Hash, XCircle, Info,
    Sparkles, Highlighter, Save, Undo2, Redo2
} from "lucide-react";
import { cn } from "@/lib/utils";
import EditorAITools from "./EditorAITools";
import ReadabilityReview from "./ReadabilityReview";
import EditorExportMenu from "./EditorExportMenu";
import { editorPrimary, editorSecondary, editorInput } from "./editor-ui";
import { useDocumentAutosave } from "@/hooks/useDocumentAutosave";

// ---------------------------------------------------------------------------
// DOMPurify — tüm semantik HTML taglarını koru, tablo ve figür dahil
// ---------------------------------------------------------------------------
const PROSE_PURIFY_CONFIG = {
    ALLOWED_TAGS: [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "strong", "em", "b", "i", "u", "s", "br", "hr",
        "ul", "ol", "li",
        "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
        "figure", "figcaption", "img",
        "a", "blockquote", "cite", "pre", "code", "span", "div",
        "details", "summary",
    ],
    ALLOWED_ATTR: [
        "href", "src", "alt", "title", "target", "rel",
        "class", "id", "style",
        "width", "height", "loading",
        "colspan", "rowspan",
        "data-img-placeholder", "data-image-prompt",
    ],
    // Allow data: URIs so Gemini base64 images are not stripped
    ALLOW_DATA_URI_TAGS: ["img"],
    ADD_URI_SAFE_ATTR: ["src"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORCE_BODY: false,
};

// ---------------------------------------------------------------------------
// READABILITY HIGHLIGHT (Faz 3) — inline decorations for sentences flagged by
// lib/readability.ts checks. Decorations (not marks) on purpose: they never
// touch the document/HTML output, survive edits via position mapping, and
// clear with a single empty DecorationSet dispatch.
// ---------------------------------------------------------------------------
const readabilityHighlightKey = new PluginKey<DecorationSet>('readabilityHighlight');

const ReadabilityHighlight = Extension.create({
    name: 'readabilityHighlight',
    addProseMirrorPlugins() {
        return [
            new Plugin<DecorationSet>({
                key: readabilityHighlightKey,
                state: {
                    init: () => DecorationSet.empty,
                    apply(tr, old) {
                        const meta = tr.getMeta(readabilityHighlightKey);
                        if (meta !== undefined) return meta as DecorationSet;
                        return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
                    },
                },
                props: {
                    decorations(state) {
                        return readabilityHighlightKey.getState(state) ?? DecorationSet.empty;
                    },
                },
            }),
        ];
    },
});

// ---------------------------------------------------------------------------
// findPhraseRanges — locates a plain-text sentence (as extracted by the
// readability engine, i.e. whitespace-collapsed) inside the TipTap doc and
// returns document position ranges. Handles inline marks splitting text nodes
// and whitespace differences via a normalized-index → doc-position map.
// ---------------------------------------------------------------------------
function findPhraseRanges(doc: PMNode, phrase: string): { from: number; to: number }[] {
    const ranges: { from: number; to: number }[] = [];
    const needle = phrase.replace(/\s+/g, ' ').trim();
    if (needle.length < 4) return ranges;

    doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;

        // Concatenate the block's inline text, remembering each character's doc position.
        let blockText = '';
        const charPos: number[] = [];
        node.forEach((child, offset) => {
            if (child.isText && child.text) {
                for (let i = 0; i < child.text.length; i++) charPos.push(pos + 1 + offset + i);
                blockText += child.text;
            } else {
                charPos.push(pos + 1 + offset);
                blockText += ' ';
            }
        });

        // Normalize whitespace while keeping a map back to raw indices.
        let norm = '';
        const normToRaw: number[] = [];
        let prevSpace = false;
        for (let i = 0; i < blockText.length; i++) {
            const isSpace = /\s/.test(blockText[i]);
            if (isSpace) {
                if (prevSpace) continue;
                norm += ' ';
                normToRaw.push(i);
                prevSpace = true;
            } else {
                norm += blockText[i];
                normToRaw.push(i);
                prevSpace = false;
            }
        }

        let searchFrom = 0;
        while (searchFrom < norm.length) {
            const idx = norm.indexOf(needle, searchFrom);
            if (idx === -1) break;
            const rawStart = normToRaw[idx];
            const rawEnd = normToRaw[Math.min(idx + needle.length - 1, normToRaw.length - 1)];
            ranges.push({ from: charPos[rawStart], to: charPos[rawEnd] + 1 });
            searchFrom = idx + needle.length;
        }
        return false; // don't descend further into this block
    });

    return ranges;
}

// ---------------------------------------------------------------------------
// TipTap extensions — tablo desteği dahil
// ---------------------------------------------------------------------------
const globalEditorExtensions = [
    // Keep one link extension, with the editor's existing click behavior.
    StarterKit.configure({ link: false }),
    Image.extend({
        addAttributes() {
            return { ...this.parent?.(), prompt: {
                default: null,
                parseHTML: element => element.getAttribute('data-image-prompt'),
                renderHTML: attributes => attributes.prompt ? { 'data-image-prompt': attributes.prompt } : {},
            } };
        },
    }).configure({
        inline: true,
        allowBase64: true,  // Allow data:image/... URIs from Gemini
    }),
    Link.configure({ openOnClick: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    ReadabilityHighlight,
];

interface ProseEditorProps {
    blocks?: GeneratedBlock[];
    outlineData: FinalOutlineData;
    initialHtml?: string;
    documentId?: string;
    initialRevision?: string;
}

type SidebarTab = 'optimize' | 'research' | 'technical';

function AccordionSection({
    title, icon: Icon, badgeCount, defaultOpen = false, tooltip, children
}: {
    title: string; icon: any; badgeCount?: number | string; defaultOpen?: boolean; tooltip?: string; children: React.ReactNode
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
                    {tooltip && (
                        <span
                            title={tooltip}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center cursor-help text-gray-400 hover:text-indigo-500 transition-colors"
                        >
                            <Info size={13} />
                        </span>
                    )}
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

// ---------------------------------------------------------------------------
// stripBase64Images — clipboard'a gönderilmeden önce data: URI'larını kaldır.
// BUG 2 FIX: Turndown base64 img src'yi olduğu gibi Markdown string'e basıyor
// → ~300KB text clipboard'a yazılıyor → yapıştırınca saçma uzun içerik çıkıyor.
// Çözüm: figure/img[src^="data:"] elemanlarını kaldır, wp:image comment'larını temizle.
// ---------------------------------------------------------------------------
function stripBase64ImagesFromHtml(html: string): string {
    // Server-side safe: basit regex ile strip (DOM API yok)
    return html
        // wp:image comment'larını kaldır
        .replace(/<!-- wp:image[^>]*-->[\s\S]*?<!-- \/wp:image -->/gi, "")
        // data: URI içeren figure bloklarını kaldır
        .replace(/<figure[^>]*>[\s\S]*?<img[^>]+src="data:[^"]*"[\s\S]*?<\/figure>/gi, "")
        // Kalan tekil data: URI img taglarını kaldır
        .replace(/<img[^>]+src="data:[^"]*"[^>]*\/?>/gi, "")
        // Placeholder figure'ları kaldır (placehold.co)
        .replace(/<figure[^>]*data-img-placeholder[^>]*>[\s\S]*?<\/figure>/gi, "")
        .trim();
}

export default function ProseEditor({ blocks, outlineData, initialHtml, documentId, initialRevision }: ProseEditorProps) {
    const [activeTab, setActiveTab] = useState<SidebarTab>('optimize');
    const [isPublishing, setIsPublishing] = useState<boolean>(false);
    const [isProofreading, setIsProofreading] = useState<boolean>(false);
    const [isExportingWord, setIsExportingWord] = useState(false);
    const [exportMessage, setExportMessage] = useState<string | null>(null);
    const [exportError, setExportError] = useState(false);
    const wordExportInProgress = useRef(false);
    const [contentReady, setContentReady] = useState(false);
    const [currentHtml, setCurrentHtml] = useState<string>("");

    const [seoMeta, setSeoMeta] = useState({
        focusKeyword: "",
        metaTitle: "",
        metaDescription: ""
    });

    // -----------------------------------------------------------------------
    // HTML üretici — DOMPurify'ı tablo taglarını koruyacak config ile çağır
    // -----------------------------------------------------------------------
    const generateHTMLFromBlocks = useCallback((): string => {
        if (initialHtml) {
            return DOMPurify.sanitize(initialHtml, PROSE_PURIFY_CONFIG);
        }
        if (!blocks || blocks.length === 0) return "";

        const rawHtml = blocks.map(block => {
            // V2 engine tek "html" bloğu olarak gönderiyor — direkt kullan
            if ((block.type as any) === 'html' && typeof block.content === 'string') {
                return block.content;
            }
            // V1 legacy block formatları
            if (block.type === 'h2' && typeof block.content === 'string') return `<h2>${block.content}</h2>`;
            if (block.type === 'h3' && typeof block.content === 'string') return `<h3>${block.content}</h3>`;
            if (block.type === 'paragraph' && typeof block.content === 'string') return block.content;
            if (block.type === 'image' && typeof block.content === 'string') return block.content;
            return '';
        }).join('\n');

        return DOMPurify.sanitize(rawHtml, PROSE_PURIFY_CONFIG);
    }, [blocks, initialHtml]);

    useEffect(() => {
        const fallbackTitle =
            (outlineData as any).title ||
            outlineData.headings?.[0]?.text ||
            "Generated SEO Article";
        const fallbackKeyword = outlineData.selectedKeywords?.[0] || "";
        const fallbackDesc = `Learn everything about ${fallbackKeyword} — expert analysis, data, and actionable insights.`;

        // Priority 1: SEO metadata block appended by LiveGeneration (v2 pipeline)
        if (blocks && blocks.length > 0) {
            const seoBlock = blocks.find((b) => b.type === "seo_metadata");
            if (seoBlock?.content) {
                const meta =
                    typeof seoBlock.content === "string"
                        ? JSON.parse(seoBlock.content)
                        : seoBlock.content;
                setSeoMeta({
                    focusKeyword: meta.focusKeyword || fallbackKeyword,
                    metaTitle: meta.metaTitle || fallbackTitle,
                    metaDescription: meta.metaDescription || fallbackDesc,
                });
                return;
            }
        }

        // Priority 2: seoMetadata restored from the database via editor/[id]/page.tsx
        const savedMeta = (outlineData as any).seoMetadata;
        if (savedMeta?.metaTitle) {
            setSeoMeta({
                focusKeyword: savedMeta.focusKeyword || fallbackKeyword,
                metaTitle: savedMeta.metaTitle,
                metaDescription: savedMeta.metaDescription || fallbackDesc,
            });
            return;
        }

        // Fallback: populate from outline context
        setSeoMeta({
            focusKeyword: fallbackKeyword,
            metaTitle: fallbackTitle,
            metaDescription: fallbackDesc,
        });
    }, [blocks, outlineData]);

    const editor = useEditor({
        extensions: globalEditorExtensions,
        content: generateHTMLFromBlocks(),
        immediatelyRender: false,
        editorProps: {
            attributes: {
                class: 'contentforge-editor prose prose-lg prose-blue dark:prose-invert max-w-none focus:outline-none min-h-[500px] p-4 prose-table:w-full prose-th:border prose-th:border-gray-300 prose-th:px-3 prose-th:py-2 prose-th:bg-gray-50 prose-th:dark:bg-gray-800 prose-td:border prose-td:border-gray-300 prose-td:px-3 prose-td:py-2',
            },
        },
        onUpdate({ editor }) {
            setCurrentHtml(editor.getHTML());
            editor.view.dispatch(editor.state.tr.setMeta(readabilityHighlightKey, DecorationSet.empty));
            setActiveHighlightCheck(null);
        },
        onCreate({ editor }) {
            setCurrentHtml(editor.getHTML());
            setContentReady(true);
        }
    });

    // -----------------------------------------------------------------------
    // blocks değiştiğinde editör içeriğini güncelle
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (editor && blocks && blocks.length > 0) {
            const html = generateHTMLFromBlocks();
            if (html) {
                editor.commands.setContent(html, { emitUpdate: true });
            }
        }
    }, [editor, blocks, generateHTMLFromBlocks]);

    // v3: article language drives the readability formula (EN Flesch / TR Ateşman)
    const [articleLanguage, setArticleLanguage] = useState(() => {
        const language = outlineData.config?.language || "";
        return /^(tr|turk|türk)/i.test(language) ? "tr" : "en";
    });
    const [analysisHtml, setAnalysisHtml] = useState(currentHtml);
    useEffect(() => {
        const timer = setTimeout(() => setAnalysisHtml(currentHtml), 350);
        return () => clearTimeout(timer);
    }, [currentHtml]);

    const contentStats = useMemo(() => analyzeContent(analysisHtml, "", articleLanguage), [analysisHtml, articleLanguage]);
    const readability = useMemo(() => analyzeReadability(analysisHtml, articleLanguage), [analysisHtml, articleLanguage]);
    const checklist = useMemo(() => runSeoChecklist(currentHtml, seoMeta), [currentHtml, seoMeta]);
    const checklistScore = checklist.filter(c => c.pass).length;

    const previousReport = useRef<typeof readability | null>(null);
    const previousLanguage = useRef(articleLanguage);
    const [scoreChange, setScoreChange] = useState<{ before: number; after: number; resolved: number } | null>(null);
    useEffect(() => {
        const previous = previousReport.current;
        if (previousLanguage.current !== articleLanguage || readability.insufficientProse) {
            setScoreChange(null);
        } else if (previous && !previous.insufficientProse) {
            const problems = (report: typeof readability) => report.checks.filter(check => check.status !== "good").length;
            setScoreChange({ before: previous.score, after: readability.score, resolved: Math.max(0, problems(previous) - problems(readability)) });
        }
        previousLanguage.current = articleLanguage;
        previousReport.current = readability;
    }, [readability, articleLanguage]);

    // ── Readability checklist interactions ─────────────────────────────────
    const [activeHighlightCheck, setActiveHighlightCheck] = useState<string | null>(null);
    const [reviewCheck, setReviewCheck] = useState<ReadabilityCheck | null>(null);
    const scoreOpportunity = scoreImprovementCheck(readability, outlineData.config?.contentType, articleLanguage);

    const applyReadabilityHighlights = useCallback((checkId: string | null, items: string[]) => {
        if (!editor) return;
        const { state, view } = editor;

        if (!checkId || items.length === 0) {
            view.dispatch(state.tr.setMeta(readabilityHighlightKey, DecorationSet.empty));
            setActiveHighlightCheck(null);
            return;
        }

        const decorations: Decoration[] = [];
        let firstFrom: number | null = null;
        for (const item of items) {
            for (const range of findPhraseRanges(state.doc, item)) {
                decorations.push(Decoration.inline(range.from, range.to, {
                    style: 'background-color: rgba(250,204,21,0.35); box-shadow: inset 0 -2px 0 #f59e0b; border-radius: 2px;'
                }));
                if (firstFrom === null || range.from < firstFrom) firstFrom = range.from;
            }
        }

        view.dispatch(state.tr.setMeta(readabilityHighlightKey, DecorationSet.create(state.doc, decorations)));
        setActiveHighlightCheck(checkId);
        if (firstFrom !== null) {
            editor.chain().setTextSelection(firstFrom).scrollIntoView().run();
        }
    }, [editor]);

    const keywordDensity = useMemo(() => {
        const keywordsToTrack = Array.from(new Set([
            seoMeta.focusKeyword,
            ...(outlineData.selectedKeywords || [])
        ])).filter(k => k.trim().length > 0);
        return analyzeKeywordDensity(currentHtml, keywordsToTrack);
    }, [currentHtml, seoMeta.focusKeyword, outlineData.selectedKeywords]);

    const { status: saveStatus, error: saveError, saveNow } = useDocumentAutosave({
        title: seoMeta.metaTitle,
        content: currentHtml,
        inputData: { ...outlineData, config: { ...outlineData.config, language: articleLanguage }, seoMetadata: seoMeta },
        seoMetadata: seoMeta,
    }, documentId, initialRevision, contentReady && !!seoMeta.metaTitle);

    // -----------------------------------------------------------------------
    // BUG 2 FIX: base64 img src'leri Turndown'a vermeden önce strip et.
    // Turndown, data: URI'yi olduğu gibi Markdown string'e basıyor → ~300KB
    // clipboard. stripBase64ImagesFromHtml() bunu önler.
    // -----------------------------------------------------------------------
    const handleExportWord = async () => {
        if (!editor || editor.isEmpty || wordExportInProgress.current) return;
        wordExportInProgress.current = true;
        setIsExportingWord(true);
        setExportMessage(null);
        setExportError(false);
        // Snapshot now, so typing while images load cannot change this export.
        const document = editor.getJSON();
        try {
            const { downloadWordDocument } = await import("@/lib/word-export");
            const missing = await downloadWordDocument(document, seoMeta.metaTitle || "Article");
            setExportMessage(missing > 0
                ? "Word file downloaded. " + missing + " image(s) could not be included; placeholders show where they belong."
                : "Word file downloaded.");
        } catch (error) {
            console.error("[WORD_EXPORT_ERROR]", error);
            setExportError(true);
            setExportMessage("Word export failed. Please try again.");
        } finally {
            wordExportInProgress.current = false;
            setIsExportingWord(false);
        }
    };

    const handleExportMarkdown = async () => {
        if (!editor) return;
        try {
            const rawHtml = editor.getHTML();
            // Strip base64/placeholder images before converting to Markdown
            const cleanHtml = stripBase64ImagesFromHtml(rawHtml);
            const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
            // Tablo dönüşümü için turndown table eklentisi (basit fallback)
            turndownService.addRule('table', {
                filter: ['table'],
                replacement: (content, node) => {
                    return '\n\n' + (node as HTMLElement).outerHTML + '\n\n';
                }
            });
            const markdown = turndownService.turndown(cleanHtml);
            await navigator.clipboard.writeText(markdown);
            setExportError(false);
            setExportMessage("Copied as Markdown.");
        } catch (error) {
            console.error("[CLIPBOARD_ACCESS_FAULT]:", error);
            setExportError(true);
            setExportMessage("Clipboard access denied. Please verify your browser permissions.");
        }
    };

    // -----------------------------------------------------------------------
    // BUG 1 FIX: Copy HTML — editördeki tam HTML'i (h2/h3/table/figure dahil)
    // olduğu gibi kopyalar. WordPress HTML editörüne yapıştırınca biçim korunur.
    // Base64 görseller strip edilir (zaten WP'e upload edilmeleri gerekir).
    // -----------------------------------------------------------------------
    const handleCopyHtml = async () => {
        if (!editor) return;
        try {
            const rawHtml = editor.getHTML();
            // Strip base64/placeholder images — WP'e base64 göndermek anlamsız
            const cleanHtml = stripBase64ImagesFromHtml(rawHtml);
            await navigator.clipboard.writeText(cleanHtml);
            setExportError(false);
            setExportMessage("HTML copied.");
        } catch (error) {
            console.error("[CLIPBOARD_HTML_FAULT]:", error);
            setExportError(true);
            setExportMessage("Clipboard access denied. Please verify your browser permissions.");
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
            editor.commands.setContent(DOMPurify.sanitize(data.result, PROSE_PURIFY_CONFIG));
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

                    {saveStatus === 'pending' && <span role="status" className="text-sm text-amber-600">Unsaved changes</span>}
                    {saveStatus === 'saving' && (
                        <span className="text-sm font-medium text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-md flex items-center gap-1.5">
                            <Loader2 size={16} className="animate-spin" /> Saving changes...
                        </span>
                    )}
                    {saveStatus === 'saved' && (
                        <span className="text-sm font-medium text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-md flex items-center gap-1.5">
                            <CheckCircle2 size={16} /> Saved to History
                        </span>
                    )}
                    {saveStatus === 'error' && (
                        <span className="text-sm font-medium text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded-md flex items-center gap-1.5">
                            <AlertCircle size={16} /> Save failed
                        </span>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => void saveNow()} disabled={saveStatus === 'saving'} className={editorSecondary}><Save size={16} className="text-indigo-500" />Save now</button>
                    {/* Faz 6.1: Proofread stays wired exactly as-is but is hidden from users.
                        Kept in the DOM (display:none) so handleProofread/isProofreading remain referenced. */}
                    <div className="hidden">
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
                    </div>

                    <EditorExportMenu copyHtml={handleCopyHtml} copyMarkdown={handleExportMarkdown} exportWord={handleExportWord} exporting={isExportingWord} empty={editor.isEmpty} />

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

            {editor && reviewCheck && <ReadabilityReview editor={editor} check={reviewCheck} language={articleLanguage} onClose={() => { setReviewCheck(null); applyReadabilityHighlights(null, []); }} />}
            {saveError && <p role="alert" className="p-3 text-sm text-red-600">{saveError}</p>}
            {exportMessage && (
                <p role={exportError ? "alert" : "status"} className={cn(
                    "px-5 py-3 text-sm border-x border-gray-200 dark:border-gray-800",
                    exportError ? "text-red-700 dark:text-red-400" : "text-slate-700 dark:text-slate-300"
                )}>
                    {exportMessage}
                </p>
            )}

            <div className="flex flex-col lg:flex-row border-x border-b border-gray-200 dark:border-gray-800 rounded-b-2xl overflow-hidden bg-gray-50/30 dark:bg-gray-900/50">
                <div data-editor-scroll className="min-w-0 flex-1 p-8 lg:p-12 bg-white dark:bg-[#0B1120] overflow-y-auto max-h-[800px] scroll-smooth relative">
                    <EditorAITools editor={editor} language={articleLanguage} title={seoMeta.metaTitle} />
                    <div className="flex gap-2 mb-3">
                        <button className={editorSecondary + " !px-2.5 !py-1.5 !text-xs"} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={14} />Undo</button>
                        <button className={editorSecondary + " !px-2.5 !py-1.5 !text-xs"} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={14} />Redo</button>
                    </div>
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
                                <AccordionSection title="Readability" icon={BookOpen} badgeCount={`${contentStats.readingTime} min`} defaultOpen={true} tooltip={contentStats.readabilityFormula === 'atesman'
                                    ? "Makalenizin okunma kolaylığı (Ateşman formülü). Yüksek skor daha sade, taranabilir metin demektir — genel kitle için 55+ hedefleyin."
                                    : "How easy your article is to read. A higher Flesch score means simpler, more scannable text — aim for 60+ for a general audience."}>
                                    <div className="space-y-4">
                                        <div>
                                            <div className="flex justify-between text-sm mb-1">
                                                <span className="text-gray-600 dark:text-gray-400 font-medium">
                                                    {contentStats.readabilityFormula === 'atesman' ? 'Ateşman Okunabilirlik' : 'Flesch Reading Ease'}
                                                </span>
                                                <span className="flex items-center gap-1.5 text-gray-900 dark:text-white font-bold">
                                                    {readability.insufficientProse ? "Not enough text" : contentStats.fleschScore + "/100 (" + contentStats.fleschLabel + ")"}
                                                </span>
                                            </div>
                                            <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                                <div className={cn("h-full rounded-full transition-all duration-500", contentStats.fleschColor)} style={{ width: `${contentStats.fleschScore}%` }}></div>
                                            </div>
                                        </div>

                                        <label className="block text-xs text-gray-500">Article language
                                            <select aria-label="Article language" value={articleLanguage} onChange={event => setArticleLanguage(event.target.value)} className={editorInput + " !w-auto !py-1.5 ml-2"}>
                                                <option value="en">English</option><option value="tr">Türkçe</option>
                                            </select>
                                        </label>
                                        <p className="text-xs text-gray-500">
                                            {readability.insufficientProse
                                                ? "Add at least 40 words of prose for a reliable score."
                                                : "Target: " + readabilityMinScore(outlineData.config?.contentType, articleLanguage) + "+/100. The formula uses sentence length and syllables per word. Paragraph layout and transitions are separate writing suggestions."}
                                        </p>
                                        {currentHtml !== analysisHtml && <p role="status" className="text-xs text-blue-600">Updating analysis...</p>}
                                        {scoreChange && !readability.insufficientProse && <p role="status" className="text-xs" data-testid="score-change">
                                            {scoreChange.before} → {scoreChange.after}: {scoreChange.after > scoreChange.before ? "+" : ""}{scoreChange.after - scoreChange.before} points.
                                            {" "}{scoreChange.resolved} checklist issues resolved in the last edit.
                                        </p>}

                                        {scoreOpportunity && <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
                                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Improve the score</p>
                                            <p className="text-xs text-gray-600 dark:text-gray-300">{scoreOpportunity.message}</p>
                                            <button className={editorPrimary + " !text-xs"} disabled={currentHtml !== analysisHtml || !!reviewCheck} onClick={() => setReviewCheck(scoreOpportunity)}>
                                                <Sparkles size={14} />Review score suggestions
                                            </button>
                                        </div>}

                                        {/* ── Kişiselleştirilmiş iyileştirme listesi (Faz 3) ──
                                            Deterministic checks from lib/readability.ts — each item
                                            names the exact sentences, highlights them in the editor,
                                            and offers a one-click targeted AI fix. */}
                                        {!readability.insufficientProse && readability.checks.length > 0 && (
                                            <div className="space-y-2">
                                                <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                                                    Improvement Checklist
                                                </div>
                                                {readability.checks.map((check) => (
                                                    <details key={check.id} className="group bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 [&_summary::-webkit-details-marker]:hidden">
                                                        <summary className="flex items-center justify-between p-2.5 cursor-pointer list-none">
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                {check.status === 'good'
                                                                    ? <CheckCircle2 size={15} className="shrink-0 text-green-500" />
                                                                    : check.status === 'warning'
                                                                        ? <AlertCircle size={15} className="shrink-0 text-yellow-500" />
                                                                        : <XCircle size={15} className="shrink-0 text-red-500" />}
                                                                <span className={cn("text-sm font-medium truncate", check.status === 'good' ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-gray-200")}>
                                                                    {check.label}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <span className="text-xs font-bold text-gray-500 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">
                                                                    {check.id === 'transition-words' ? `${check.count}/${check.total}` : check.count}
                                                                </span>
                                                                <ChevronDown size={13} className="text-gray-400 group-open:rotate-180 transition-transform" />
                                                            </div>
                                                        </summary>
                                                        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-100 dark:border-gray-800">
                                                            <p className="text-xs text-gray-600 dark:text-gray-300">{check.message}</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400 italic">{check.suggestion}</p>
                                                            <p className="text-[11px] text-gray-500">{check.affectsScore ? "Related to score: sentence length or word complexity." : "Writing suggestion: fixing this alone may leave the score unchanged."}</p>
                                                            {check.items.length > 0 && check.status !== 'good' && (
                                                                <div className="flex items-center gap-2 pt-1">
                                                                    <button
                                                                        onClick={() => activeHighlightCheck === check.id
                                                                            ? applyReadabilityHighlights(null, [])
                                                                            : applyReadabilityHighlights(check.id, check.items)}
                                                                        className={cn(
                                                                            "flex items-center gap-1 px-2 py-1 text-[11px] font-bold rounded-md border transition-colors",
                                                                            activeHighlightCheck === check.id
                                                                                ? "bg-yellow-100 border-yellow-300 text-yellow-800 dark:bg-yellow-900/40 dark:border-yellow-700 dark:text-yellow-300"
                                                                                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300"
                                                                        )}
                                                                    >
                                                                        <Highlighter size={11} />
                                                                        {activeHighlightCheck === check.id ? 'Clear' : 'Show in text'}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setReviewCheck(check)}
                                                                        disabled={reviewCheck !== null || currentHtml !== analysisHtml}
                                                                        className={editorPrimary + " !px-2.5 !py-1.5 !text-xs"}
                                                                    >
                                                                        <Sparkles size={13} />
                                                                        Fix with AI
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </details>
                                                ))}
                                            </div>
                                        )}

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

                                <AccordionSection title="SEO Checklist" icon={ListChecks} badgeCount={`${checklistScore}/10`} defaultOpen={false} tooltip="A pass/fail check on on-page SEO basics: keyword placement, headings, links, and length. Aim for 8/10 or higher before publishing.">
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

                                <AccordionSection title="Keyword Density" icon={Hash} badgeCount={keywordDensity.length} defaultOpen={false} tooltip="How often each keyword appears vs. total words. Keep your main keyword near 0.5–1.5%; going over ~2.5% looks like keyword stuffing and can hurt rankings.">
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