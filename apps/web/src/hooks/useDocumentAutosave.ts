"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Snapshot {
    title: string;
    content: string;
    inputData: object;
    seoMetadata: object;
}

export function useDocumentAutosave(snapshot: Snapshot, documentId?: string, initialRevision?: string, ready = true) {
    const [status, setStatus] = useState<"pending" | "saving" | "saved" | "error">(documentId ? "saved" : "pending");
    const [error, setError] = useState("");
    const [savedId, setSavedId] = useState(documentId);
    const id = useRef(documentId);
    const revision = useRef(initialRevision);
    const created = useRef(!!documentId);
    const latest = useRef("");
    const persisted = useRef("");
    const busy = useRef(false);
    const mounted = useRef(true);
    const enabled = useRef(false);
    const blocked = useRef(false);
    const initialized = useRef(false);
    const flushRef = useRef<() => Promise<void>>(async () => {});
    const serialized = JSON.stringify(snapshot);

    const flush = useCallback(async () => {
        if (!enabled.current || busy.current || blocked.current || latest.current === persisted.current) return;
        busy.current = true;
        const value = latest.current;
        if (!id.current) id.current = crypto.randomUUID();
        if (mounted.current) { setStatus("saving"); setError(""); }
        let succeeded = false;
        try {
            const response = await fetch("/api/documents/save", {
                method: "POST", signal: AbortSignal.timeout(30_000), headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...JSON.parse(value), documentId: id.current, create: !created.current,
                    revision: revision.current, aiModel: "CLAUDE_SONNET_4_6",
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                if (response.status === 409 || response.status === 404) blocked.current = true;
                throw new Error(result.message || "Could not save. Please retry.");
            }
            revision.current = result.revision;
            created.current = true;
            persisted.current = value;
            succeeded = true;
            if (mounted.current) {
                setSavedId(result.documentId);
                setStatus(latest.current === value ? "saved" : "pending");
            }
        } catch (cause) {
            if (mounted.current) {
                setStatus("error");
                setError(cause instanceof Error ? cause.message : "Could not save. Please retry.");
            }
        } finally {
            busy.current = false;
            // Serialize writes: an older request can never overtake a newer edit.
            if (succeeded && latest.current !== persisted.current) void flushRef.current();
        }
    }, []);
    useEffect(() => { flushRef.current = flush; }, [flush]);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    useEffect(() => {
        latest.current = serialized;
        enabled.current = ready;
        if (!ready) return;
        if (!initialized.current) {
            initialized.current = true;
            if (documentId && initialRevision) {
                persisted.current = serialized;
                setStatus("saved");
                return;
            }
        }
        if (blocked.current) return;
        if (serialized === persisted.current) {
            // An in-flight save may still persist a different snapshot.
            setStatus(busy.current ? "saving" : "saved");
            return;
        }
        if (!blocked.current) setStatus(busy.current ? "saving" : "pending");
        const timer = setTimeout(() => void flush(), 800);
        return () => clearTimeout(timer);
    }, [serialized, ready, flush, documentId, initialRevision]);
    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (enabled.current && latest.current !== persisted.current) {
                event.preventDefault();
                event.returnValue = "";
            }
        };
        const onVisibility = () => {
            if (document.visibilityState === "hidden") void flush();
        };
        window.addEventListener("beforeunload", beforeUnload);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.removeEventListener("beforeunload", beforeUnload);
            document.removeEventListener("visibilitychange", onVisibility);
            void flush();
        };
    }, [flush]);
    return { status, error, savedId, saveNow: flush };
}
