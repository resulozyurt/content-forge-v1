// apps/web/src/app/[locale]/(app)/user-settings/page.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { User, Lock, Bell, Loader2, CheckCircle2, ShieldAlert, Camera } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "profile" | "security" | "preferences";

export default function UserSettingsPage() {
    const [activeTab, setActiveTab] = useState<Tab>("profile");
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [formData, setFormData] = useState({
        name: "", email: "", phone: "", company: "", industry: "", jobTitle: "",
        marketingConsent: false, language: "en", timezone: "Europe/London",
        image: "", currentPassword: "", newPassword: "", confirmPassword: ""
    });

    useEffect(() => {
        const fetchUserData = async () => {
            try {
                const res = await fetch("/api/user/profile");
                if (res.ok) {
                    const data = await res.json();
                    setFormData(prev => ({ ...prev, ...data }));
                }
            } catch (error) {
                console.error("Failed to fetch user data", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchUserData();
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : value
        }));
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            setSaveMessage({ text: "Image size must be less than 5MB.", type: "error" });
            return;
        }

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const MAX_WIDTH = 400; const MAX_HEIGHT = 400;
                let width = img.width; let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                } else {
                    if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                }

                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx?.drawImage(img, 0, 0, width, height);

                const base64String = canvas.toDataURL("image/jpeg", 0.8);
                setFormData(prev => ({ ...prev, image: base64String }));
            };
        };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaveMessage(null);

        if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
            setSaveMessage({ text: "New passwords do not match.", type: "error" });
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch("/api/user/profile", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Update failed.");

            setSaveMessage({ text: "Account settings updated successfully.", type: "success" });
            setFormData(prev => ({ ...prev, currentPassword: "", newPassword: "", confirmPassword: "" }));

            setTimeout(() => setSaveMessage(null), 3000);
        } catch (error: any) {
            setSaveMessage({ text: error.message, type: "error" });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>;
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500 pb-12">
            <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Account Settings</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    Manage your personal information, security preferences, and communications.
                </p>
            </div>

            {/* Horizontal Tabs Navigation */}
            <div className="flex space-x-2 bg-gray-100/80 dark:bg-gray-800/50 p-1.5 rounded-xl overflow-x-auto border border-gray-200 dark:border-gray-700/50">
                <button
                    onClick={() => setActiveTab("profile")}
                    className={cn("flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg transition-all duration-200", activeTab === "profile" ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm" : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-white/50 dark:hover:bg-gray-800")}
                >
                    <User size={16} /> Profile
                </button>
                <button
                    onClick={() => setActiveTab("security")}
                    className={cn("flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg transition-all duration-200", activeTab === "security" ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm" : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-white/50 dark:hover:bg-gray-800")}
                >
                    <Lock size={16} /> Security
                </button>
                <button
                    onClick={() => setActiveTab("preferences")}
                    className={cn("flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg transition-all duration-200", activeTab === "preferences" ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm" : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-white/50 dark:hover:bg-gray-800")}
                >
                    <Bell size={16} /> Preferences
                </button>
            </div>

            {/* Main Form Content */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
                <form onSubmit={handleSubmit} className="p-8">

                    {/* PROFILE TAB */}
                    {activeTab === "profile" && (
                        <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-4">General Information</h2>

                            <div className="flex items-center gap-6 pb-4">
                                <div className="relative w-24 h-24 rounded-full overflow-hidden bg-gray-100 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 flex items-center justify-center group">
                                    {formData.image ? (
                                        <img src={formData.image} alt="Profile" className="w-full h-full object-cover" />
                                    ) : (
                                        <User size={40} className="text-gray-400" />
                                    )}
                                    <div onClick={() => fileInputRef.current?.click()} className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                                        <Camera size={20} className="text-white mb-1" />
                                        <span className="text-[10px] text-white font-medium">Change</span>
                                    </div>
                                    <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/jpeg, image/png, image/webp" className="hidden" />
                                </div>
                                <div>
                                    <h3 className="font-medium text-gray-900 dark:text-white">Profile Picture</h3>
                                    <p className="text-xs text-gray-500 mt-1">JPG, PNG or WebP. Max 5MB.<br />Image will be compressed automatically.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Full Name</label>
                                    <input type="text" name="name" value={formData.name || ""} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-white" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Email Address (Read-only)</label>
                                    <input type="email" value={formData.email || ""} disabled className="w-full p-2.5 bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-500 cursor-not-allowed" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Phone Number</label>
                                    <input type="tel" name="phone" value={formData.phone || ""} onChange={handleChange} placeholder="+1 555 555 5555" className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-white" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Job Title</label>
                                    <input type="text" name="jobTitle" value={formData.jobTitle || ""} onChange={handleChange} placeholder="e.g. SEO Specialist" className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-white" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Company Name</label>
                                    <input type="text" name="company" value={formData.company || ""} onChange={handleChange} placeholder="Your Company" className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-white" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Industry</label>
                                    <select name="industry" value={formData.industry || ""} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-white">
                                        <option value="">Select...</option>
                                        <option value="Technology & Software">Technology & Software</option>
                                        <option value="E-commerce">E-commerce</option>
                                        <option value="Healthcare">Healthcare</option>
                                        <option value="Finance">Finance</option>
                                        <option value="Education">Education</option>
                                        <option value="Marketing & Media">Marketing & Media</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* SECURITY TAB */}
                    {activeTab === "security" && (
                        <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-4">Security Settings</h2>

                            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50 rounded-xl p-4 flex items-start gap-3">
                                <ShieldAlert className="text-orange-500 shrink-0 mt-0.5" size={20} />
                                <p className="text-sm text-orange-800 dark:text-orange-300 leading-relaxed">
                                    Keep your password strong for account security. If you registered via a social media account (Google, Github, etc.), you cannot change your password here.
                                </p>
                            </div>

                            <div className="max-w-md space-y-4 pt-2">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Current Password</label>
                                    <input type="password" name="currentPassword" value={formData.currentPassword} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-white" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">New Password</label>
                                    <input type="password" name="newPassword" value={formData.newPassword} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-white" />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Confirm New Password</label>
                                    <input type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-white" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* PREFERENCES TAB */}
                    {activeTab === "preferences" && (
                        <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-4">Application Preferences</h2>

                            <div className="max-w-md space-y-6">
                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Interface Language</label>
                                    <select name="language" value={formData.language} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-white">
                                        <option value="en">English</option>
                                        <option value="tr">Türkçe</option>
                                    </select>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Timezone</label>
                                    <select name="timezone" value={formData.timezone || "Europe/London"} onChange={handleChange} className="w-full p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-white">
                                        <option value="America/New_York">America/New_York (EST)</option>
                                        <option value="Europe/London">Europe/London (GMT+0)</option>
                                        <option value="Europe/Istanbul">Europe/Istanbul (GMT+3)</option>
                                    </select>
                                </div>

                                <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                                    <label className="flex items-start gap-3 cursor-pointer group">
                                        <div className="relative flex items-center justify-center mt-0.5">
                                            <input type="checkbox" name="marketingConsent" checked={formData.marketingConsent} onChange={handleChange} className="peer sr-only" />
                                            <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 peer-checked:bg-blue-600 peer-checked:border-blue-600 transition-all"></div>
                                            <CheckCircle2 size={14} className="absolute text-white opacity-0 peer-checked:opacity-100 transition-opacity" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors">Marketing Communications</p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                                                I agree to receive emails regarding platform updates, educational content, and special offers.
                                            </p>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* FOOTER ACTIONS */}
                    <div className="mt-10 pt-6 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                        <div className="flex-1">
                            {saveMessage && (
                                <div className={cn("text-sm font-medium flex items-center gap-2", saveMessage.type === "success" ? "text-green-600" : "text-red-500 animate-pulse")}>
                                    {saveMessage.type === "success" ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
                                    {saveMessage.text}
                                </div>
                            )}
                        </div>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className={cn(
                                "px-6 py-2.5 rounded-lg text-white font-bold text-sm flex items-center gap-2 transition-all shadow-md",
                                isSaving ? "bg-blue-400 cursor-not-allowed" : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 hover:scale-[1.02]"
                            )}
                        >
                            {isSaving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : "Save Changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}