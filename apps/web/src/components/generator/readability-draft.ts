import type { Editor } from "@tiptap/react";
import { DOMParser as PMDOMParser, DOMSerializer } from "@tiptap/pm/model";
import DOMPurify from "isomorphic-dompurify";

export type ReviewTarget = { from: number; to: number; html: string; text: string };
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

export function collectReviewTargets(editor: Editor, items: string[]): ReviewTarget[] {
    const targets: ReviewTarget[] = [];
    const needles = items.map(normalize).filter(Boolean);
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "table") return false;
        if (node.type.name !== "paragraph") return true;
        const text = normalize(node.textBetween(0, node.content.size, " ", " "));
        let hasImage = false;
        node.descendants(child => { if (child.type.name === "image") hasImage = true; });
        if (!hasImage && needles.some(item => text.includes(item))) {
            const container = document.createElement("div");
            container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeNode(node));
            targets.push({ from: pos, to: pos + node.nodeSize, html: container.innerHTML, text });
        }
        return false;
    });
    // Prioritize the analyzer's hardest passages, then restore document order for replacement.
    const rank = (target: ReviewTarget) => needles.findIndex(item => target.text.includes(item));
    return targets.sort((a, b) => rank(a) - rank(b)).slice(0, 8).sort((a, b) => a.from - b.from);
}

function linkSignatures(container: HTMLElement) {
    return [...container.querySelectorAll("a")].map(link => JSON.stringify(
        ["href", "target", "rel"].map(name => link.getAttribute(name) || "")
    )).sort();
}

/** Builds a detached transaction; no editor state, history or autosave changes until dispatch. */
export function buildReadabilityDraft(editor: Editor, targets: ReviewTarget[], results: string[]) {
    if (results.length !== targets.length) throw new Error("The review is incomplete. Your article has not changed.");
    const clean = results.map((result, index) => {
        const html = DOMPurify.sanitize(result, {
            ALLOWED_TAGS: ["p", "strong", "b", "em", "i", "u", "s", "a", "br", "code"],
            ALLOWED_ATTR: ["href", "target", "rel"],
        });
        const container = document.createElement("div");
        container.innerHTML = html;
        if (!container.textContent?.trim() || !container.children.length ||
            [...container.childNodes].some(node => node.nodeType === Node.TEXT_NODE
                ? !!node.textContent?.trim() : !(node instanceof HTMLElement) || node.tagName !== "P")) {
            throw new Error("The AI did not return complete paragraphs. Please try again.");
        }
        const original = document.createElement("div");
        original.innerHTML = targets[index].html;
        if (JSON.stringify(linkSignatures(original)) !== JSON.stringify(linkSignatures(container))) {
            throw new Error("The result changed or removed a link. Your article has not changed. Ask the AI to preserve all links.");
        }
        return html;
    });
    const transaction = editor.state.tr;
    for (let index = targets.length - 1; index >= 0; index--) {
        const container = document.createElement("div");
        container.innerHTML = clean[index];
        transaction.replaceWith(targets[index].from, targets[index].to,
            PMDOMParser.fromSchema(editor.schema).parseSlice(container).content);
    }
    const container = document.createElement("div");
    container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(transaction.doc.content));
    return { transaction, html: container.innerHTML, clean };
}
