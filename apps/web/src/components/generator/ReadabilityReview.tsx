"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogPanel, DialogTitle, Description } from "@headlessui/react";
import type { Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { Loader2, Sparkles, X } from "lucide-react";
import { analyzeReadability, type ReadabilityCheck } from "@/lib/readability";
import { assessReadabilityChange, readabilityInstructions } from "@/lib/readability-review";
import { buildReadabilityDraft, collectReviewTargets } from "./readability-draft";
import { editorPrimary, editorSecondary, editorInput, editorIconButton } from "./editor-ui";

export default function ReadabilityReview({ editor, check, language, onClose }: {
    editor: Editor; check: ReadabilityCheck; language: string; onClose: () => void;
}) {
    const [snapshot] = useState(() => editor.state.doc);
    const [targets] = useState(() => collectReviewTargets(editor, check.items));
    const [before] = useState(() => analyzeReadability(editor.getHTML(), language));
    const [prompt, setPrompt] = useState(readabilityInstructions[check.id] || check.suggestion);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [preview, setPreview] = useState<{
        clean: string[]; after: ReturnType<typeof analyzeReadability>;
        assessment: ReturnType<typeof assessReadabilityChange>;
    } | null>(null);
    const controller = useRef<AbortController | null>(null);
    const resultPanel = useRef<HTMLDivElement>(null);
    useEffect(() => () => controller.current?.abort(), []);
    useEffect(() => { if (preview) resultPanel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [preview]);

    const assertCurrent = () => {
        if (editor.isDestroyed || !editor.state.doc.eq(snapshot)) {
            throw new Error("The article changed while this review was open. Close it and review the latest text.");
        }
    };
    const generate = async () => {
        if (busy || !prompt.trim() || !targets.length) return;
        setBusy(true); setError(""); setPreview(null);
        const abort = new AbortController();
        controller.current = abort;
        const timeout = setTimeout(() => abort.abort(), 90000);
        try {
            assertCurrent();
            const response = await fetch("/api/v2/generator/edit", {
                method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
                body: JSON.stringify({ action: "ReadabilityReview", issue: check.id, prompt: prompt.trim(),
                    language, paragraphs: targets.map(target => target.html) }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not generate a review.");
            assertCurrent();
            if (!Array.isArray(data.results) || data.results.some((item: unknown) => typeof item !== "string")) {
                throw new Error("The AI returned an invalid review. Your article has not changed.");
            }
            const draft = buildReadabilityDraft(editor, targets, data.results);
            const after = analyzeReadability(draft.html, language);
            setPreview({ clean: draft.clean, after, assessment: assessReadabilityChange(before, after, check.id, check.affectsScore) });
        } catch (cause) {
            setError(abort.signal.aborted ? "Generation was cancelled or timed out. Your article has not changed."
                : cause instanceof Error ? cause.message : "Review failed. Please try again.");
        } finally { clearTimeout(timeout); controller.current = null; setBusy(false); }
    };
    const apply = () => {
        if (!preview?.assessment.allowed) return;
        try {
            assertCurrent();
            const draft = buildReadabilityDraft(editor, targets, preview.clean);
            editor.view.dispatch(closeHistory(draft.transaction));
            onClose();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not apply this review."); }
    };

    return <Dialog open onClose={onClose} className="fixed inset-0 z-[80]">
        <div className="fixed inset-0 bg-gray-950/45 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4">
            <DialogPanel className="w-full max-w-3xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-5 dark:border-gray-800">
                    <div>
                        <DialogTitle className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"><Sparkles size={18} className="text-indigo-500" />Review readability: {check.label}</DialogTitle>
                        <Description className="mt-1 text-sm text-gray-500 dark:text-gray-400">Check the issue, add your instructions, and compare the result before applying.</Description>
                    </div>
                    <button className={editorIconButton} onClick={onClose} aria-label="Close readability review"><X size={18} /></button>
                </div>
                <div className="max-h-[65vh] space-y-4 overflow-y-auto p-5">
                    <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{check.message}</p>
                        <p className="text-gray-600 dark:text-gray-300">{check.suggestion}</p>
                        <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">{check.affectsScore
                            ? "Score improvement: a measurable increase is required before applying."
                            : "Writing improvement: this check can improve without increasing the formula score."}</p>
                    </div>
                    <label className="block space-y-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                        <span>Correction instructions</span>
                        <textarea data-autofocus aria-label="Correction instructions" rows={3} maxLength={2000} value={prompt}
                            onChange={event => { setPrompt(event.target.value); setPreview(null); }} disabled={busy} className={editorInput} />
                    </label>
                    <p className="text-xs text-gray-500">Reviewing {targets.length} affected paragraphs (up to 8 per review). Scores are measured across the entire article. Each generated preview uses 1 credit.</p>
                    {!targets.length && <p role="alert" className="text-sm text-amber-700">No editable paragraphs match this check. The flagged text may be in a table or may have changed. Close this review and check the latest analysis.</p>}
                    {!preview && targets.length > 0 && <details className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                        <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">Passages to review</summary>
                        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-gray-600 dark:text-gray-300">{targets.map(target => <li key={target.from}>{target.text}</li>)}</ol>
                    </details>}
                    {preview && <div ref={resultPanel} className="space-y-4">
                        <div data-testid="readability-preview-score" className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">Whole article: {before.score}/100 → {preview.after.score}/100 ({preview.assessment.delta > 0 ? "+" : ""}{preview.assessment.delta} points)</p>
                            <p role="status" className="mt-1 text-sm text-gray-600 dark:text-gray-300">{preview.assessment.reason}</p>
                        </div>
                        {targets.map((target, index) => <div key={target.from} className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Current</p>
                                <div className="prose prose-sm dark:prose-invert max-w-none prose-a:text-indigo-600" dangerouslySetInnerHTML={{ __html: target.html }} />
                            </div>
                            <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-3 dark:border-indigo-900 dark:bg-indigo-950/20">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Proposed</p>
                                <div className="prose prose-sm dark:prose-invert max-w-none prose-a:text-indigo-600" dangerouslySetInnerHTML={{ __html: preview.clean[index] }} />
                            </div>
                        </div>)}
                    </div>}
                    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 bg-gray-50/70 p-4 dark:border-gray-800 dark:bg-gray-950/30">
                    <button onClick={onClose} className={editorSecondary}>Cancel</button>
                    <button onClick={() => void generate()} disabled={busy || !prompt.trim() || !targets.length} className={preview ? editorSecondary : editorPrimary}>
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{busy ? "Generating..." : preview ? "Try again" : "Generate preview"}
                    </button>
                    {preview && <button onClick={apply} disabled={busy || !preview.assessment.allowed} className={editorPrimary}>Apply changes</button>}
                </div>
            </DialogPanel>
        </div>
    </Dialog>;
}
