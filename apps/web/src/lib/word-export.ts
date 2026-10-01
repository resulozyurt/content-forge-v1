import {
    AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel,
    ImageRun, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow,
    TextRun, UnderlineType, WidthType,
    type ILevelsOptions, type IRunOptions, type ParagraphChild,
} from "docx";

// TipTap JSON is the source of truth, including edits not yet saved to the server.
export interface WordNode {
    type?: string;
    text?: string;
    attrs?: Record<string, unknown>;
    marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
    content?: WordNode[];
}

export interface WordImage {
    data: Uint8Array;
    width: number;
    height: number;
}
type ImageLoader = (src: string) => Promise<WordImage>;
type WordBlock = Paragraph | Table;
const PAGE_WIDTH = 9638;
const LINK_COLOR = "2563EB";

function textOf(node: WordNode): string {
    return node.text ?? (node.content ?? []).map(textOf).join("");
}

export function wordFileName(title: string): string {
    const safe = title.normalize("NFC")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
        .replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 100).trim();
    const name = safe && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)
        ? safe : "Article";
    return name + ".docx";
}

function safeLink(value: unknown): string | null {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value);
        return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? value : null;
    } catch {
        return null;
    }
}

/** Fetches only in the user's browser; no server-side proxy or credentials. */
export async function loadWordImage(src: string): Promise<WordImage> {
    if (!/^(https?:|blob:|data:image\/)/i.test(src)) throw new Error("Unsupported image");
    const response = await fetch(src, {
        credentials: "omit", referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Image unavailable");
    const blob = await response.blob();
    if (blob.size > 12 * 1024 * 1024) throw new Error("Image is too large");
    const bitmap = await createImageBitmap(blob);
    try {
        const scale = Math.min(1, 1200 / bitmap.width, 1520 / bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image conversion unavailable");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const png = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(value => value ? resolve(value) : reject(new Error("Image conversion failed")), "image/png")
        );
        return { data: new Uint8Array(await png.arrayBuffer()), width: bitmap.width, height: bitmap.height };
    } finally {
        bitmap.close();
    }
}

export async function createWordDocument(
    root: WordNode,
    fallbackTitle = "Article",
    loadImage: ImageLoader = loadWordImage,
): Promise<{ document: Document; title: string; missingImages: number }> {
    const title = textOf((root.content ?? []).find(node => node.type === "heading" && node.attrs?.level === 1) ?? {})
        .trim() || fallbackTitle.trim() || "Article";
    let missingImages = 0;
    const imageCache = new Map<string, WordImage | null>();
    const numbering: Array<{ reference: string; levels: ILevelsOptions[] }> = [];

    async function inline(nodes: WordNode[], maxWidth: number, base: IRunOptions = {}): Promise<ParagraphChild[]> {
        const result: ParagraphChild[] = [];
        for (const node of nodes) {
            if (node.type === "hardBreak") {
                result.push(new TextRun({ break: 1 }));
            } else if (node.type === "image") {
                const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
                const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "Article image";
                if (!imageCache.has(src)) {
                    try { imageCache.set(src, await loadImage(src)); }
                    catch { imageCache.set(src, null); }
                }
                const image = imageCache.get(src);
                if (!image || image.width <= 0 || image.height <= 0) {
                    missingImages += 1;
                    result.push(new TextRun({ text: "[Image unavailable: " + (alt || "Article image") + "]", italics: true, color: "64748B" }));
                } else {
                    const scale = Math.min(1, maxWidth / image.width, 720 / image.height);
                    result.push(new ImageRun({
                        type: "png", data: image.data,
                        transformation: { width: Math.max(1, Math.floor(image.width * scale)), height: Math.max(1, Math.floor(image.height * scale)) },
                        altText: { title: alt, description: alt, name: alt },
                    }));
                }
            } else if (node.type === "text") {
                const marks = node.marks ?? [];
                const link = safeLink(marks.find(mark => mark.type === "link")?.attrs?.href);
                const run = new TextRun({
                    ...base, text: node.text ?? "",
                    ...(base.bold || marks.some(mark => mark.type === "bold") ? { bold: true } : {}),
                    ...(base.italics || marks.some(mark => mark.type === "italic") ? { italics: true } : {}),
                    ...(marks.some(mark => mark.type === "strike") ? { strike: true } : {}),
                    ...(marks.some(mark => mark.type === "code") ? { font: "Consolas" } : {}),
                    ...(marks.some(mark => mark.type === "underline") || link ? { underline: { type: UnderlineType.SINGLE } } : {}),
                    ...(link ? { color: LINK_COLOR } : {}),
                });
                result.push(link ? new ExternalHyperlink({ link, children: [run] }) : run);
            } else if (node.content) {
                result.push(...await inline(node.content, maxWidth, base));
            }
        }
        return result;
    }

    async function paragraph(node: WordNode, width: number, indent = 0, list?: { reference: string }, base?: IRunOptions): Promise<Paragraph> {
        const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
        const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
        return new Paragraph({
            children: await inline(node.content ?? [], Math.max(80, (width - indent) / 15), base),
            ...(node.type === "heading" ? { heading: headings[level - 1], keepNext: true } : {}),
            ...(list ? { numbering: { reference: list.reference, level: 0 } } : {}),
            ...(indent && !list ? { indent: { left: indent } } : {}),
            spacing: { after: 160, line: 276 },
        });
    }

    async function blocks(nodes: WordNode[], width = PAGE_WIDTH, indent = 0, base?: IRunOptions): Promise<WordBlock[]> {
        const result: WordBlock[] = [];
        for (const node of nodes) {
            if (node.type === "paragraph" || node.type === "heading") {
                result.push(await paragraph(node, width, indent, undefined, base));
            } else if (node.type === "bulletList" || node.type === "orderedList") {
                const reference = "list-" + numbering.length;
                numbering.push({
                    reference,
                    levels: [{
                        level: 0,
                        format: node.type === "orderedList" ? LevelFormat.DECIMAL : LevelFormat.BULLET,
                        text: node.type === "orderedList" ? "%1." : "•",
                        start: Math.max(1, Number(node.attrs?.start) || 1),
                        alignment: AlignmentType.LEFT,
                        style: { paragraph: { indent: { left: indent + 420, hanging: 240 } } },
                    }],
                });
                for (const item of node.content ?? []) {
                    const children = item.content ?? [];
                    if (children[0]?.type === "paragraph") {
                        result.push(await paragraph(children[0], width, indent + 420, { reference }, base));
                        result.push(...await blocks(children.slice(1), width, indent + 420, base));
                    } else {
                        result.push(await paragraph({ content: [] }, width, indent + 420, { reference }, base));
                        result.push(...await blocks(children, width, indent + 420, base));
                    }
                }
            } else if (node.type === "table") {
                const rows = node.content ?? [];
                if (!rows.length) continue;
                const columns = Math.max(1, ...rows.map(row => (row.content ?? [])
                    .reduce((sum, cell) => sum + Math.max(1, Number(cell.attrs?.colspan) || 1), 0)));
                const tableWidth = width - indent;
                const wordRows: TableRow[] = [];
                for (const row of rows) {
                    const cells: TableCell[] = [];
                    for (const cell of row.content ?? []) {
                        const span = Math.max(1, Number(cell.attrs?.colspan) || 1);
                        const cellWidth = Math.floor(tableWidth * span / columns);
                        const content = await blocks(cell.content ?? [], Math.max(600, cellWidth - 240), 0,
                            cell.type === "tableHeader" ? { bold: true } : undefined);
                        cells.push(new TableCell({
                            children: content.length ? content : [new Paragraph("")],
                            width: { size: cellWidth, type: WidthType.DXA },
                            columnSpan: span, rowSpan: Math.max(1, Number(cell.attrs?.rowspan) || 1),
                            margins: { top: 100, bottom: 100, left: 120, right: 120 },
                            ...(cell.type === "tableHeader" ? { shading: { fill: "EFF6FF" } } : {}),
                        }));
                    }
                    if (cells.length) wordRows.push(new TableRow({
                        children: cells,
                        tableHeader: (row.content ?? []).every(cell => cell.type === "tableHeader"),
                    }));
                }
                if (wordRows.length) {
                    result.push(new Table({
                        rows: wordRows, width: { size: tableWidth, type: WidthType.DXA },
                        columnWidths: Array.from({ length: columns }, () => Math.floor(tableWidth / columns)),
                        borders: Object.fromEntries(["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"]
                            .map(side => [side, { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" }])),
                    }), new Paragraph({ spacing: { after: 80 } }));
                }
            } else if (node.type === "blockquote") {
                result.push(...await blocks(node.content ?? [], width, indent + 360, { ...base, italics: true }));
            } else if (node.type === "codeBlock") {
                result.push(new Paragraph({
                    children: textOf(node).split("\n").map((text, index) =>
                        new TextRun({ text, font: "Consolas", size: 19, ...(index ? { break: 1 } : {}) })),
                    shading: { fill: "F1F5F9" }, spacing: { after: 160 },
                }));
            } else if (node.type === "horizontalRule") {
                result.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" } } }));
            } else if (node.type === "image") {
                result.push(new Paragraph({ children: await inline([node], width / 15), spacing: { after: 160 } }));
            } else if (node.content) {
                result.push(...await blocks(node.content, width, indent, base));
            }
        }
        return result;
    }

    const children = await blocks(root.content ?? []);
    const document = new Document({
        title, creator: "ContentForge",
        styles: {
            default: {
                document: { run: { font: "Calibri", size: 22, color: "1E293B" } },
                heading1: { run: { font: "Calibri", size: 36, bold: true, color: "0F172A" }, paragraph: { spacing: { before: 240, after: 180 } } },
                heading2: { run: { font: "Calibri", size: 28, bold: true, color: "0F172A" }, paragraph: { spacing: { before: 200, after: 140 } } },
                heading3: { run: { font: "Calibri", size: 24, bold: true, color: "0F172A" } },
            },
        },
        numbering: { config: numbering },
        sections: [{
            properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
            children: children.length ? children : [new Paragraph("")],
        }],
    });
    return { document, title, missingImages };
}

export async function downloadWordDocument(root: WordNode, fallbackTitle: string): Promise<number> {
    const result = await createWordDocument(root, fallbackTitle);
    const blob = await Packer.toBlob(result.document);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = wordFileName(result.title);
    document.body.appendChild(link);
    try { link.click(); }
    finally {
        link.remove();
        // Leave time for the browser to begin reading the download.
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    return result.missingImages;
}
