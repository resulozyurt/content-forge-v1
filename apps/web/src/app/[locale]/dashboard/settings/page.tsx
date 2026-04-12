// apps/web/src/app/[locale]/dashboard/settings/page.tsx
"use client";

import { useState, useEffect } from "react";
import { Save, Link as LinkIcon, Key, Globe, CheckCircle2, AlertCircle, RefreshCw, Server, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
    // Form Stateleri
    const [wpUrl, setWpUrl] = useState("");
    const [wpUsername, setWpUsername] = useState("");
    const [wpAppPassword, setWpAppPassword] = useState("");
    const [defaultStatus, setDefaultStatus] = useState("draft");
    const [wpSitemap, setWpSitemap] = useState("");
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<'idle' | 'success' | 'error'>('idle');
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true); // Sayfa ilk açıldığında yükleniyor statesi

    // 1. Sayfa Açıldığında Veritabanından Ayarları Çek
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch('/api/user/settings');
                if (res.ok) {
                    const data = await res.json();
                    if (data) {
                        setWpUrl(data.wpUrl || "");
                        setWpUsername(data.wpUsername || "");
                        setWpAppPassword(data.wpAppPassword || "");
                        setWpSitemap(data.wpSitemap || "");
                        setDefaultStatus(data.defaultStatus || "draft");
                    }
                }
            } catch (error) {
                console.error("Failed to fetch settings", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchSettings();
    }, []);

    // Python wp.py Entegrasyon Simülasyonu
    const handleTestConnection = async () => {
        if (!wpUrl || !wpUsername || !wpAppPassword) {
            alert("Please fill in all WordPress credentials first.");
            return;
        }

        setIsTesting(true);
        setTestResult('idle');

        // Gerçekte burada Python API'ye istek gidecek
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Simüle edilmiş başarı
        setTestResult('success');
        setIsTesting(false);
    };

    // 2. Veritabanına Gerçek Kayıt İşlemi
    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);

        try {
            const res = await fetch('/api/user/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wpUrl, wpUsername, wpAppPassword, wpSitemap, defaultStatus })
            });

            if (res.ok) {
                alert("Settings saved successfully!");
            } else {
                alert("Failed to save settings.");
            }
        } catch (error) {
            console.error("Error saving settings", error);
            alert("An error occurred while saving.");
        } finally {
            setIsSaving(false);
        }
    };

    // Veriler veritabanından çekilirken gösterilecek yükleme ekranı
    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-[60vh]">
                <div className="flex flex-col items-center gap-4 text-gray-500">
                    <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                    <p className="text-sm font-medium">Loading settings...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">

            {/* Header Section */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white transition-colors">
                    Integrations & Settings
                </h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 transition-colors">
                    Connect your WordPress site and configure default publishing behaviors.
                </p>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-6">

                {/* WordPress Connection Card */}
                <div className="bg-white dark:bg-gray-900 shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden transition-colors">
                    <div className="p-6 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Server className="w-5 h-5 text-blue-600" />
                            WordPress Connection
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Link your site using Application Passwords to automatically publish AI-generated content.
                        </p>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* WP URL */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                WordPress Site URL
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Globe className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    type="url"
                                    value={wpUrl}
                                    onChange={(e) => setWpUrl(e.target.value)}
                                    placeholder="https://yoursite.com"
                                    className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                                    required
                                />
                            </div>
                        </div>

                        {/* WP Sitemap URL */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                XML Sitemap URL (For Internal Linking)
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Layers className="h-5 w-5 text-gray-400" />
                                </div>
                                <input
                                    type="url"
                                    value={wpSitemap}
                                    onChange={(e) => setWpSitemap(e.target.value)}
                                    placeholder="https://yoursite.com/sitemap_index.xml"
                                    className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* WP Username */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    Username or Email
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <LinkIcon className="h-5 w-5 text-gray-400" />
                                    </div>
                                    <input
                                        type="text"
                                        value={wpUsername}
                                        onChange={(e) => setWpUsername(e.target.value)}
                                        placeholder="admin"
                                        className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                                        required
                                    />
                                </div>
                            </div>

                            {/* WP Application Password */}
                            <div>
                                <label className="flex items-center justify-between text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    <span>Application Password</span>
                                    <a href="#" className="text-xs text-blue-600 hover:underline font-normal">How to get this?</a>
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Key className="h-5 w-5 text-gray-400" />
                                    </div>
                                    <input
                                        type="password"
                                        value={wpAppPassword}
                                        onChange={(e) => setWpAppPassword(e.target.value)}
                                        placeholder="xxxx xxxx xxxx xxxx"
                                        className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Test Connection Button & Status */}
                        <div className="pt-4 flex items-center gap-4">
                            <button
                                type="button"
                                onClick={handleTestConnection}
                                disabled={isTesting}
                                className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-700 shadow-sm text-sm font-medium rounded-lg text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                            >
                                {isTesting ? (
                                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Testing Connection...</>
                                ) : (
                                    <><Globe className="w-4 h-4 mr-2" /> Test WP Connection</>
                                )}
                            </button>

                            {testResult === 'success' && (
                                <span className="flex items-center text-sm text-green-600 font-bold animate-in fade-in">
                                    <CheckCircle2 className="w-4 h-4 mr-1" /> Connection Successful!
                                </span>
                            )}
                            {testResult === 'error' && (
                                <span className="flex items-center text-sm text-red-600 font-bold animate-in fade-in">
                                    <AlertCircle className="w-4 h-4 mr-1" /> Invalid Credentials
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Publishing Defaults Card */}
                <div className="bg-white dark:bg-gray-900 shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden transition-colors">
                    <div className="p-6 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            Publishing Defaults
                        </h2>
                    </div>

                    <div className="p-6">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Default Post Status
                        </label>
                        <select
                            value={defaultStatus}
                            onChange={(e) => setDefaultStatus(e.target.value)}
                            className="block w-full max-w-sm pl-3 pr-10 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                        >
                            <option value="draft">Save as Draft (Recommended)</option>
                            <option value="publish">Publish Immediately</option>
                            <option value="pending">Pending Review</option>
                        </select>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            When exporting from the AI Editor, articles will be sent to WordPress using this status.
                        </p>
                    </div>
                </div>

                {/* Submit Form */}
                <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-800">
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-bold rounded-xl shadow-md text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-all hover:scale-105"
                    >
                        {isSaving ? (
                            <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Saving...</>
                        ) : (
                            <><Save className="w-5 h-5 mr-2" /> Save Settings</>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}