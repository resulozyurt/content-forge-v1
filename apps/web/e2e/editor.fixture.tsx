"use client";

// Copied into app/ only while test:editor runs. This fixture is not a production route.
import { useEffect, useState } from "react";
import ProseEditor from "@/components/generator/ProseEditor";
import { initialConfigData, type FinalOutlineData } from "@/types/generator";

type Saved = { id: string; outputContent: string; inputPayload: FinalOutlineData; updatedAt: string };
const paragraph = "Our team can help you build clear plans and make good choices for your work each day. We share useful tips so you can save time and spend less on tasks that do not help your team grow.";
export default function EditorFixture() {
    const [state, setState] = useState<{ saved?: Saved; image: string } | null>(null);
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 160; canvas.height = 80;
        canvas.getContext("2d")!.fillRect(0, 0, 160, 80);
        const image = canvas.toDataURL("image/png");
        if (new URLSearchParams(location.search).has("history")) {
            fetch("/api/documents/history").then(r => r.json()).then(data => setState({ saved: data.jobs[0], image }));
        } else setState({ image });
        });
        return () => cancelAnimationFrame(frame);
    }, []);
    if (!state) return <p>Loading fixture...</p>;
    const long = new URLSearchParams(location.search).has("long");
    return <main className="p-6">
        <a href="/en/editor-e2e.test?history=1">Open saved article from History</a>
        <ProseEditor
            initialHtml={state.saved?.outputContent || '<h2>Planning guide</h2><p>' + (long ? Array(14).fill(paragraph).join('</p><p>') : paragraph) + '</p><p>Read our <a href="https://example.com/guide">helpful guide</a> and choose a clear goal for the week.</p><p><img src="' + state.image + '" alt="Original test image"></p>'}
            documentId={state.saved?.id}
            initialRevision={state.saved?.updatedAt}
            outlineData={state.saved?.inputPayload || { headings: [{ id: "one", text: "Planning guide", level: "h2" }], selectedKeywords: ["planning"], config: { ...initialConfigData, language: "en" } }}
        />
    </main>;
}
