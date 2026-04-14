// apps/web/src/app/[locale]/dashboard/settings/page.tsx
"use client";

import { useState, useEffect } from "react";
import { Save, Globe, User, Lock, Server, ShieldCheck, Loader2, CheckCircle2, Receipt, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [transactions, setTransactions] = useState<any[]>([]);

    // Form State Architecture
    const [formData, setFormData] = useState({
        wpUrl: "",
        wpUsername: "",
        wpAppPassword: "", // Write-only field from the UI perspective
        defaultStatus: "draft"
    });

    // Fetch existing configuration and billing history on component mount
    useEffect(() => {
        let isMounted = true;

        const fetchSettingsAndBilling = async () => {
            try {
                // 1. Fetch Integration Settings
                const settingsRes = await fetch("/api/user/settings");
                if (settingsRes.ok) {
                    const data = await settingsRes.json();
                    if (isMounted && data.settings) {
                        setFormData(prev => ({
                            ...prev,
                            wpUrl: data.settings.wpUrl || "",
                            wpUsername: data.settings.wpUsername || "",
                            defaultStatus: data.settings.defaultStatus || "draft",
                        }));
                    }
                }

                // 2. Fetch Transaction History
                const txRes = await fetch("/api/user/transactions");
                if (txRes.ok) {
                    const txData = await txRes.json();
                    if (isMounted && txData.transactions) {
                        setTransactions(txData.transactions);
                    }
                }

            } catch (error) {
                console.error("[FETCH_FAULT] Unable to load configuration or billing data.", error);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        fetchSettingsAndBilling();
        return () => { isMounted = false; };
    }, []);

    // Handle form synchronization with the backend registry
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setSaveSuccess(false);

        try {
            const res = await fetch("/api/user/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData)
            });

            if (!res.ok) throw new Error("Synchronization failed.");

            setSaveSuccess(true);

            // Clear the password field after successful secure transmission
            setFormData(prev => ({ ...prev, wpAppPassword: "" }));

            // Reset success message after 3 seconds
            setTimeout(() => setSaveSuccess(false), 3000);

        } catch (error) {
            console.error("[SYNC_FAULT] Configuration update failed.", error);
            alert("Failed to save settings. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex h-[600px] w-full items-center justify-center">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">

            <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Platform Configuration</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Manage your integration endpoints, security credentials, and global preferences.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">

                {/* Integration Parameters Card */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
                    <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 px-6 py-4 flex items-center gap-3">
                        <Server className="w-5 h-5 text-indigo-500" />
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">WordPress Integration</h2>
                    </div>

                    <div className="p-6 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                            {/* Endpoint URL */}
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Target Endpoint URL</label>
                                <div className="relative">
                                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                    <input
                                        type="url"
                                        placeholder="https://yourwebsite.com"
                                        value={formData.wpUrl}
                                        onChange={(e) => setFormData({ ...formData, wpUrl: e.target.value })}
                                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all dark:text-white"
                                    />
                                </div>
                                <p className="text-xs text-gray-500">The root URL of your WordPress installation.</p>
                            </div>

                            {/* Authentication Username */}
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Admin Username</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="admin_user"
                                        value={formData.wpUsername}
                                        onChange={(e) => setFormData({ ...formData, wpUsername: e.target.value })}
                                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all dark:text-white"
                                    />
                                </div>
                            </div>

                            {/* Application Password (Secure) */}
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Application Password</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                    <input
                                        type="password"
                                        placeholder="Leave blank to keep current password"
                                        value={formData.wpAppPassword}
                                        onChange={(e) => setFormData({ ...formData, wpAppPassword: e.target.value })}
                                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all dark:text-white"
                                    />
                                </div>
                                <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-1.5">
                                    <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
                                    Credentials are encrypted via AES-256 before storage.
                                </p>
                            </div>
                        </div>

                        <hr className="border-gray-200 dark:border-gray-800" />

                        {/* Default Publishing Behavior */}
                        <div className="space-y-3">
                            <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Default Publishing Status</label>
                            <div className="flex items-center gap-6">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="status"
                                        value="draft"
                                        checked={formData.defaultStatus === "draft"}
                                        onChange={(e) => setFormData({ ...formData, defaultStatus: e.target.value })}
                                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Draft (Recommended)</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="status"
                                        value="publish"
                                        checked={formData.defaultStatus === "publish"}
                                        onChange={(e) => setFormData({ ...formData, defaultStatus: e.target.value })}
                                        className="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">Publish Immediately</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Form Actions */}
                <div className="flex items-center justify-end gap-4">
                    {saveSuccess && (
                        <span className="text-sm font-bold text-green-600 dark:text-green-400 flex items-center animate-in fade-in slide-in-from-right-4">
                            <CheckCircle2 className="w-4 h-4 mr-1.5" />
                            Configuration Secured
                        </span>
                    )}

                    <button
                        type="submit"
                        disabled={isSaving}
                        className={cn(
                            "inline-flex items-center px-6 py-2.5 text-white text-sm font-bold rounded-lg shadow-md transition-all",
                            isSaving
                                ? "bg-gray-400 cursor-not-allowed"
                                : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 hover:scale-[1.02]"
                        )}
                    >
                        {isSaving ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Securing Data...</>
                        ) : (
                            <><Save className="w-4 h-4 mr-2" /> Save Configuration</>
                        )}
                    </button>
                </div>
            </form>

            {/* Usage & Billing History Ledger */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden mt-8">
                <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 px-6 py-4 flex items-center gap-3">
                    <Receipt className="w-5 h-5 text-blue-500" />
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Usage & Billing History</h2>
                </div>
                <div className="p-0 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 uppercase text-[10px] font-bold tracking-widest">
                            <tr>
                                <th className="px-6 py-3">Event Date</th>
                                <th className="px-6 py-3">Transaction Type</th>
                                <th className="px-6 py-3">Description</th>
                                <th className="px-6 py-3 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {transactions.map((tx) => (
                                <tr key={tx.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                                        {new Date(tx.createdAt).toLocaleDateString()} {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td className="px-6 py-4 font-bold text-gray-900 dark:text-white">
                                        <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-[10px]">
                                            {tx.type}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400 italic">
                                        {tx.description || "System processing cost"}
                                    </td>
                                    <td className={cn("px-6 py-4 text-right font-bold", tx.amount < 0 ? "text-red-500" : "text-green-500")}>
                                        {tx.amount < 0 ? <ArrowDownRight size={12} className="inline mr-1" /> : <ArrowUpRight size={12} className="inline mr-1" />}
                                        {Math.abs(tx.amount)} Credits
                                    </td>
                                </tr>
                            ))}
                            {transactions.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-10 text-center text-gray-400 italic">No transactions found in this billing cycle.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
}