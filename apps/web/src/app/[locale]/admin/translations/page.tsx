// apps/web/src/app/[locale]/admin/translations/page.tsx
"use client";

import { useState, useEffect } from "react";
import { Save, Loader2, DatabaseBackup, CheckCircle2 } from "lucide-react";

export default function TranslationsManager() {
    const [translations, setTranslations] = useState<any>({ en: {}, tr: {} });
    const [selectedLang, setSelectedLang] = useState<"en" | "tr">("tr");
    const [editorValue, setEditorValue] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

    useEffect(() => {
        const fetchTranslations = async () => {
            const res = await fetch("/api/admin/translations");
            if (res.ok) {
                const data = await res.json();
                setTranslations(data.translations);
                setEditorValue(JSON.stringify(data.translations["tr"], null, 2));
                setIsLoading(false);
            }
        };
        fetchTranslations();
    }, []);

    const handleLangChange = (lang: "en" | "tr") => {
        setSelectedLang(lang);
        setEditorValue(JSON.stringify(translations[lang], null, 2));
        setSaveStatus("idle");
    };

    const handleSave = async () => {
        try {
            setIsSaving(true);
            setSaveStatus("idle");
            // Validate JSON format before sending
            const parsedJson = JSON.parse(editorValue);

            const res = await fetch("/api/admin/translations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ locale: selectedLang, translations: parsedJson })
            });

            if (!res.ok) throw new Error();

            // Update local state
            setTranslations((prev: any) => ({ ...prev, [selectedLang]: parsedJson }));
            setSaveStatus("success");
            setTimeout(() => setSaveStatus("idle"), 3000);
        } catch (error) {
            alert("Invalid JSON format! Please check your syntax before saving.");
            setSaveStatus("error");
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="w-8 h-8 text-red-500 animate-spin" /></div>;

    return (
        <div className="space-y-6 animate-in fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <DatabaseBackup className="text-red-500" /> i18n Dictionary
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">Direct read/write access to system JSON localization files.</p>
                </div>

                <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-800">
                    <button
                        onClick={() => handleLangChange("tr")}
                        className={`px-4 py-1.5 text-sm font-bold rounded-md transition-colors ${selectedLang === "tr" ? "bg-gray-800 text-white" : "text-gray-500"}`}
                    >
                        Türkçe (TR)
                    </button>
                    <button
                        onClick={() => handleLangChange("en")}
                        className={`px-4 py-1.5 text-sm font-bold rounded-md transition-colors ${selectedLang === "en" ? "bg-gray-800 text-white" : "text-gray-500"}`}
                    >
                        English (EN)
                    </button>
                </div>
            </div>

            <div className="bg-[#0a0a0a] border border-gray-800/50 rounded-xl overflow-hidden shadow-2xl flex flex-col">
                <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center justify-between">
                    <span className="text-xs font-mono text-gray-400">/apps/web/messages/{selectedLang}.json</span>

                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded text-sm font-bold transition-colors disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Commit Overwrite
                    </button>
                </div>

                {/* Code Editor Area */}
                <textarea
                    value={editorValue}
                    onChange={(e) => setEditorValue(e.target.value)}
                    spellCheck={false}
                    className="w-full h-[600px] bg-[#050505] text-green-400 font-mono text-sm p-6 outline-none resize-none leading-relaxed"
                />
            </div>

            {saveStatus === "success" && (
                <p className="text-green-500 font-mono text-sm flex items-center gap-2 animate-pulse">
                    <CheckCircle2 className="w-4 h-4" /> Translation dictionary securely overwritten. Changes are now live.
                </p>
            )}
        </div>
    );
}