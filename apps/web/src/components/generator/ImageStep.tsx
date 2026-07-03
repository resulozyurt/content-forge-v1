// apps/web/src/components/generator/ImageStep.tsx
"use client";

import { useState } from "react";
import { ImageIcon, ImageOff, Sparkles, ArrowRight } from "lucide-react";
import { ImageConfig, defaultImageConfig } from "@/types/generator";

interface ImageStepProps {
    initialConfig?: ImageConfig;
    onConfirm: (imageConfig: ImageConfig) => void;
}

export default function ImageStep({ initialConfig, onConfirm }: ImageStepProps) {
    const [enabled, setEnabled] = useState(initialConfig?.enabled ?? defaultImageConfig.enabled);
    const [styleGuidance, setStyleGuidance] = useState(
        initialConfig?.styleGuidance ?? defaultImageConfig.styleGuidance
    );

    const handleContinue = () => {
        const cleaned = styleGuidance.trim();
        onConfirm({
            enabled,
            // Fall back to the default guidance if the field was cleared.
            styleGuidance: cleaned.length > 0 ? cleaned : defaultImageConfig.styleGuidance,
        });
    };

    return (
        <div className="w-full max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-500">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-6 md:p-8 space-y-6">

                {/* Header */}
                <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-indigo-100 dark:bg-indigo-900/40 rounded-xl text-indigo-600 dark:text-indigo-400 flex-shrink-0 shadow-inner">
                        <ImageIcon size={22} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Article Images</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                            Want images in your article? We'll add one every few sections to break up the text and keep readers engaged. Keep them on, fine-tune the look, or skip them entirely — your call.
                        </p>
                    </div>
                </div>

                {/* Toggle */}
                <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/30">
                    <div className="flex items-center gap-3">
                        {enabled
                            ? <ImageIcon size={18} className="text-indigo-500 flex-shrink-0" />
                            : <ImageOff size={18} className="text-gray-400 flex-shrink-0" />}
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            Generate images for this article
                        </span>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        onClick={() => setEnabled((v) => !v)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${enabled ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-700"
                            }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-6" : "translate-x-1"
                                }`}
                        />
                    </button>
                </div>

                {/* Style guidance — shown only when images are enabled */}
                {enabled ? (
                    <div className="space-y-2">
                        <label htmlFor="image-style" className="block text-sm font-semibold text-gray-900 dark:text-white">
                            Image style
                        </label>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            This tells the AI how every image should look. Edit it however you like — or leave our default.
                        </p>
                        <textarea
                            id="image-style"
                            value={styleGuidance}
                            onChange={(e) => setStyleGuidance(e.target.value)}
                            rows={3}
                            placeholder={defaultImageConfig.styleGuidance}
                            className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-all resize-none leading-relaxed"
                        />
                        <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
                            <Sparkles size={12} className="text-indigo-400" />
                            The AI adds each section's subject automatically — you only set the overall look.
                        </p>
                    </div>
                ) : (
                    <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 flex items-center gap-3">
                        <ImageOff size={18} className="text-gray-400 flex-shrink-0" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            No images will be added. Your article will be all text.
                        </p>
                    </div>
                )}

                {/* Continue */}
                <div className="flex justify-end pt-2">
                    <button
                        onClick={handleContinue}
                        className="inline-flex items-center justify-center gap-2 px-8 py-3.5 text-base font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl shadow-md hover:scale-[1.02] transition-all"
                    >
                        Generate Article
                        <ArrowRight className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
}