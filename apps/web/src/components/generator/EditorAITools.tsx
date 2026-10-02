"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import DOMPurify from "isomorphic-dompurify";
import { Loader2, Sparkles, X } from "lucide-react";

type Target = { from: number; to: number; doc: PMNode; html: string; inline: boolean; kind: "text" | "image"; attrs?: Record<string, unknown> };
const presets = {
    Rewrite: "Improve clarity and flow while preserving the meaning and facts.",
    Expand: "Add useful explanations and examples. Preserve the facts and use short sentences.",
    Condense: "Make this concise without losing key facts, links, or meaning.",
};
const buttonClass = "px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50";
function selectionTarget(editor: Editor): Target | null {
    const { from, to, empty, $from, $to } = editor.state.selection;
    if (editor.state.selection instanceof NodeSelection && editor.state.selection.node.type.name === "image") {
        return { from, to, doc: editor.state.doc, html: "", inline: false, kind: "image", attrs: { ...editor.state.selection.node.attrs } };
    }
    if (empty || !editor.state.doc.textBetween(from, to, " ").trim()) return null;
    let containsImage = false;
    editor.state.doc.nodesBetween(from, to, node => { if (node.type.name === "image") containsImage = true; });
    if (containsImage) return null;
    const container = document.createElement("div");
    container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.slice(from, to).content));
    return { from, to, doc: editor.state.doc, html: container.innerHTML, inline: $from.sameParent($to) && $from.parent.inlineContent, kind: "text" };
}

export default function EditorAITools({ editor, language, title }: { editor: Editor; language: string; title: string }) {
    const [available, setAvailable] = useState<Target | null>(null);
    const [target, setTarget] = useState<Target | null>(null);
    const [prompt, setPrompt] = useState("");
    const [preview, setPreview] = useState("");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const controller = useRef<AbortController | null>(null);
    const [replacement, setReplacement] = useState<{ before: Target; after: PMNode } | null>(null);
    useEffect(() => {
        const update = () => setAvailable(selectionTarget(editor));
        editor.on("selectionUpdate", update);
        editor.on("update", update);
        return () => { editor.off("selectionUpdate", update); editor.off("update", update); controller.current?.abort(); };
    }, [editor]);
    const open = () => {
        if (!available) return;
        setTarget(available); setPreview(""); setMessage("");
        setPrompt(available.kind === "image" ? String(available.attrs?.prompt || available.attrs?.alt || "") : "");
    };
    const close = () => { controller.current?.abort(); setTarget(null); setPreview(""); setMessage(""); };
    const isCurrent = (value: Target) => editor.state.doc.eq(value.doc);
    const generate = async () => {
        if (!target || !prompt.trim() || controller.current) return;
        if (!isCurrent(target)) { setMessage("The article changed. Close this panel and select the content again."); return; }
        const abort = new AbortController();
        controller.current = abort;
        const timeout = setTimeout(() => abort.abort(), target.kind === "image" ? 150_000 : 90_000);
        setBusy(true); setMessage(""); setPreview("");
        try {
            const image = target.kind === "image";
            const response = await fetch(image ? "/api/v2/generator/image-generate" : "/api/v2/generator/edit", {
                method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
                body: JSON.stringify(image ? {
                    mode: "regenerate", prompt: prompt.trim(), sectionTitle: title, sectionIndex: -1,
                } : {
                    action: "Custom", prompt: prompt.trim(), text: target.html, inline: target.inline,
                    language, context: title,
                    surroundingText: target.doc.textBetween(Math.max(0, target.from - 400), Math.min(target.doc.content.size, target.to + 400), " "),
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Generation failed. Please retry.");
            if (abort.signal.aborted) return;
            if (!isCurrent(target)) throw new Error("The article changed while generating. Select the content again; nothing was replaced.");
            if (image) {
                if (typeof data.imageDataUri !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(data.imageDataUri)) throw new Error("No image was returned. Your original image is unchanged.");
                const img = new window.Image();
                img.src = data.imageDataUri;
                await img.decode();
                if (abort.signal.aborted || !isCurrent(target)) throw new Error("The article changed. Your original image is unchanged.");
                editor.view.dispatch(closeHistory(editor.state.tr));
                editor.commands.setNodeSelection(target.from);
                editor.chain().focus().updateAttributes("image", { src: data.imageDataUri, prompt: prompt.trim() }).run();
                setReplacement({ before: target, after: editor.state.doc });
                setTarget(null); setMessage("New image applied. Changes are being saved to History.");
            } else {
                const html = DOMPurify.sanitize(data.result, {
                    ALLOWED_TAGS: ["p", "h2", "h3", "h4", "strong", "em", "s", "u", "a", "ul", "ol", "li", "blockquote", "br", "code"],
                    ALLOWED_ATTR: ["href", "target", "rel", "start"],
                });
                if (!html.trim()) throw new Error("No usable text was returned.");
                const original = new DOMParser().parseFromString(target.html, "text/html");
                const result = new DOMParser().parseFromString(html, "text/html");
                const remainingLinks = [...result.querySelectorAll("a")];
                for (const link of original.querySelectorAll("a")) {
                    const index = remainingLinks.findIndex(other => ["href", "target", "rel"].every(attr => other.getAttribute(attr) === link.getAttribute(attr)));
                    if (index < 0) throw new Error("The result changed an existing link. Please retry; your text is unchanged.");
                    remainingLinks.splice(index, 1);
                }
                if (target.inline && result.body.querySelector("p,ul,ol,li,h2,h3,h4,blockquote")) {
                    throw new Error("The result changed the selection structure. Please retry or select a whole paragraph.");
                }
                setPreview(html);
            }
        } catch (error) {
            if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Generation failed.");
            else setMessage("Generation cancelled or timed out. Your content is unchanged.");
        } finally {
            clearTimeout(timeout); controller.current = null; setBusy(false);
        }
    };
    const apply = () => {
        if (!target || !preview) return;
        if (!isCurrent(target)) { setMessage("The article changed. Select the content again before applying."); return; }
        editor.view.dispatch(closeHistory(editor.state.tr));
        editor.chain().focus().insertContentAt({ from: target.from, to: target.to }, preview).run();
        setTarget(null); setPreview(""); setMessage("Text applied. Changes are being saved to History.");
    };
    return (
        <div className="sticky top-0 z-20 mb-3">
            {!target && available && <button className={buttonClass + " bg-white dark:bg-gray-800 shadow"} onMouseDown={e => e.preventDefault()} onClick={open}>
                <Sparkles size={14} className="inline mr-2" />{available.kind === "image" ? "Regenerate image" : "Edit selection with AI"}
            </button>}
            {target && <section aria-label={target.kind === "image" ? "Image generation" : "Text generation"} className="rounded-xl border bg-white dark:bg-gray-900 p-4 shadow-lg space-y-3">
                <div className="flex justify-between items-center"><strong>{target.kind === "image" ? "Generate a replacement image" : "Edit selected text"}</strong><button aria-label="Close AI tools" onClick={close}><X size={18} /></button></div>
                {target.kind === "text" && <div className="flex flex-wrap gap-2">{Object.entries(presets).map(([label, instruction]) => <button className={buttonClass} disabled={busy} key={label} onClick={() => { setPrompt(instruction); setPreview(""); }}>{label}</button>)}</div>}
                <label className="block text-sm">Your instructions
                    <textarea aria-label="Your instructions" value={prompt} maxLength={2000} disabled={busy} onChange={event => { setPrompt(event.target.value); setPreview(""); }} rows={3} className="mt-1 w-full rounded-lg border bg-transparent p-2" placeholder={target.kind === "image" ? "Describe the new image, composition, colors, and style..." : "Explain how you want this selection changed..."} />
                </label>
                {target.kind === "image" && <p className="text-xs text-gray-500">A new image will replace this one when ready. The current image stays visible during generation.</p>}
                <button className={buttonClass + " bg-blue-600 text-white"} disabled={busy || !prompt.trim()} onClick={() => void generate()}>{busy ? <><Loader2 size={14} className="inline animate-spin mr-2" />Generating...</> : "Generate"}</button>
                {preview && <><div aria-label="Generated text preview" className="prose dark:prose-invert max-h-64 overflow-auto border rounded p-3" dangerouslySetInnerHTML={{ __html: preview }} /><div className="flex gap-2"><button className={buttonClass} onClick={apply}>Apply</button><button className={buttonClass} onClick={() => setPreview("")}>Discard</button></div></>}
            </section>}
            {message && <p role="status" className="mt-2 rounded border bg-white dark:bg-gray-900 p-2 text-sm">{message}</p>}
            {replacement && !target && <button className={buttonClass + " mt-2"} onClick={() => {
                if (!editor.state.doc.eq(replacement.after)) { setMessage("The article has changed. Use the editor Undo button to step back through changes."); return; }
                editor.view.dispatch(closeHistory(editor.state.tr));
                editor.commands.setNodeSelection(replacement.before.from);
                editor.commands.updateAttributes("image", replacement.before.attrs || {});
                setReplacement(null); setMessage("Previous image restored.");
            }}>Restore previous image</button>}
        </div>
    );
}
