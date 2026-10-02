"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { placeSelectionPopover } from "@/lib/editor-position";

export default function SelectionPopover({ editor, from, to, image, expanded, children }: {
    editor: Editor; from: number; to: number; image: boolean; expanded: boolean; children: ReactNode;
}) {
    const panel = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", visibility: "hidden" });
    useLayoutEffect(() => {
        const element = panel.current;
        if (!element) return;
        const scroller = editor.view.dom.closest("[data-editor-scroll]") as HTMLElement | null;
        let frame = 0;
        const update = () => {
            if (editor.isDestroyed) return;
            const viewport = window.visualViewport;
            const clip = scroller?.getBoundingClientRect() || editor.view.dom.getBoundingClientRect();
            let headerBottom = viewport?.offsetTop || 0;
            for (const header of document.querySelectorAll("header")) {
                const position = getComputedStyle(header).position;
                if (position === "fixed" || position === "sticky") headerBottom = Math.max(headerBottom, header.getBoundingClientRect().bottom);
            }
            const bounds = {
                left: Math.max(viewport?.offsetLeft || 0, clip.left) + 12,
                right: Math.min((viewport?.offsetLeft || 0) + (viewport?.width || innerWidth), clip.right) - 12,
                top: Math.max(headerBottom, clip.top) + 12,
                bottom: Math.min((viewport?.offsetTop || 0) + (viewport?.height || innerHeight), clip.bottom) - 12,
            };
            if (bounds.bottom <= bounds.top || bounds.right <= bounds.left) { setStyle({ position: "fixed", visibility: "hidden" }); return; }
            const start = Math.min(from, editor.state.doc.content.size);
            const end = Math.min(to, editor.state.doc.content.size);
            let rect: DOMRect | DOMRectReadOnly;
            const node = image ? editor.view.nodeDOM(start) as HTMLElement | null : null;
            if (node?.getBoundingClientRect) rect = node.getBoundingClientRect();
            else {
                const a = editor.view.domAtPos(start), b = editor.view.domAtPos(end);
                const range = document.createRange();
                range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset);
                const visible = [...range.getClientRects()].filter(r => r.height && r.bottom > bounds.top && r.top < bounds.bottom);
                // Place the tool beside the visible end of a text selection, even when it spans many lines.
                rect = visible.at(-1) || range.getBoundingClientRect();
            }
            if (!expanded && (rect.bottom < bounds.top || rect.top > bounds.bottom)) {
                setStyle({ position: "fixed", visibility: "hidden" }); return;
            }
            const width = Math.min(expanded ? 440 : 250, bounds.right - bounds.left);
            const placement = placeSelectionPopover(rect, bounds, width, Math.min(element.scrollHeight, bounds.bottom - bounds.top));
            setStyle({ position: "fixed", left: placement.left, top: placement.top, width, maxHeight: placement.maxHeight, visibility: "visible" });
        };
        const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
        update();
        const observer = new ResizeObserver(schedule);
        observer.observe(element);
        if (scroller) observer.observe(scroller);
        window.addEventListener("scroll", schedule, true);
        window.addEventListener("resize", schedule);
        window.visualViewport?.addEventListener("resize", schedule);
        window.visualViewport?.addEventListener("scroll", schedule);
        return () => {
            observer.disconnect(); cancelAnimationFrame(frame);
            window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule);
            window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
        };
    }, [editor, from, to, image, expanded]);
    return createPortal(<div ref={panel} data-testid="selection-popover" style={style} className="z-[60] overflow-y-auto overscroll-contain rounded-xl shadow-xl">{children}</div>, document.body);
}
