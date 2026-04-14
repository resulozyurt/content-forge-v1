// apps/web/src/app/[locale]/dashboard/brand/page.tsx
"use client";

import { useState, useEffect } from "react";
import { Save, Building2, Link as LinkIcon, AlignLeft, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function BrandSettingsPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const [formData, setFormData] = useState({
        name: "",
        description: "",
        sitemapUrl: ""
    });

    useEffect(() => {
        const fetchBrand = async () => {
            try {
                const res = await fetch('/api/user/brand');
                if (res.ok) {
                    const { data } = await res.json();
                    if (data) {
                        setFormData({
                            name: data.name || "",
                            description: data.description || "",
                            sitemapUrl: data.sitemapUrl || ""
                        });
                    }
                }
            } catch (error) {
                console.error("Failed to load brand data", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchBrand();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setSaveStatus('idle');

        try {
            const res = await fetch('/api/user/brand', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (!res.ok) throw new Error("Failed to save");
            setSaveStatus('success');
            setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (error) {
            setSaveStatus('error');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-[600px] items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">

            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 shadow-sm">
                <div className="flex items-start gap-4 mb-8">
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-xl text-blue-600 dark:text-blue-400">
                        <Building2 size={28} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Brand Identity Engine</h1>
                        <p className="text-gray-500 dark:text-gray-400 mt-1 max-w-2xl text-sm leading-relaxed">
                            Define your corporate identity, target audience, and core offerings. The AI engine will utilize this context to seamlessly weave your brand into the generated content as an authoritative solution.
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Brand Name */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            Corporate Name
                        </label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="e.g., FieldPie"
                            required
                            className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        />
                    </div>

                    {/* Brand Context & Offerings */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center justify-between">
                            <span className="flex items-center gap-2"><AlignLeft size={16} className="text-gray-400" /> Core Offerings & Tone</span>
                            <span className="text-xs font-normal text-gray-400">Be descriptive for better AI integration</span>
                        </label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Describe what your product does, who it is for, and your unique value proposition. (e.g., FieldPie is an all-in-one field service management software designed for HVAC, plumbing, and cleaning businesses...)"
                            required
                            rows={5}
                            className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-y"
                        />
                    </div>

                    {/* Internal Linking Sitemap */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            <LinkIcon size={16} className="text-gray-400" /> Primary XML Sitemap
                        </label>
                        <input
                            type="url"
                            value={formData.sitemapUrl}
                            onChange={(e) => setFormData({ ...formData, sitemapUrl: e.target.value })}
                            placeholder="https://yourdomain.com/sitemap.xml"
                            className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        />
                        <p className="text-xs text-gray-500 mt-1">Providing a valid sitemap allows the AI to automatically extract relevant internal links and embed them contextually.</p>
                    </div>

                    <div className="pt-6 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-4">
                        {saveStatus === 'success' && (
                            <span className="text-sm font-bold text-green-600 flex items-center gap-2 animate-in fade-in slide-in-from-right-4">
                                <CheckCircle2 size={18} /> Brand Profile Synchronized
                            </span>
                        )}
                        {saveStatus === 'error' && (
                            <span className="text-sm font-bold text-red-600 animate-in fade-in slide-in-from-right-4">
                                Failed to synchronize profile.
                            </span>
                        )}

                        <button
                            type="submit"
                            disabled={isSaving}
                            className="inline-flex items-center px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold rounded-xl shadow-md hover:bg-gray-800 dark:hover:bg-gray-100 transition-all disabled:opacity-70 disabled:cursor-not-allowed hover:scale-[1.02]"
                        >
                            {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
                            {isSaving ? "Synchronizing..." : "Save Identity Context"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}