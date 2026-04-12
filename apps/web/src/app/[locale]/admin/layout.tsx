// apps/web/src/app/[locale]/admin/layout.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert, Users, Languages, ArrowLeft, TerminalSquare } from "lucide-react";
import { useLocale } from "next-intl";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const locale = useLocale();

    return (
        <div className="min-h-screen bg-[#050505] text-gray-300 font-sans flex selection:bg-red-500/30">
            {/* Admin Matrix Sidebar */}
            <aside className="w-64 bg-[#0a0a0a] border-r border-gray-800/50 flex flex-col shadow-2xl z-10">
                <div className="p-6 flex items-center gap-3 border-b border-gray-800/50">
                    <ShieldAlert className="text-red-500 w-8 h-8 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                    <div>
                        <span className="text-white font-bold tracking-widest uppercase text-sm block">System Root</span>
                        <span className="text-red-500/80 text-[10px] uppercase font-mono tracking-widest">Admin Matrix</span>
                    </div>
                </div>
                <nav className="flex-1 p-4 space-y-2 mt-4">
                    <Link
                        href={`/${locale}/admin`}
                        className={`flex items-center gap-3 p-3 rounded-lg text-sm font-medium transition-all ${pathname === `/${locale}/admin` ? "bg-red-500/10 text-red-500 border border-red-500/20" : "hover:bg-gray-900 text-gray-400 hover:text-gray-200"}`}
                    >
                        <Users className="w-5 h-5" /> User Registry
                    </Link>
                    <Link
                        href={`/${locale}/admin/translations`}
                        className={`flex items-center gap-3 p-3 rounded-lg text-sm font-medium transition-all ${pathname.includes('translations') ? "bg-red-500/10 text-red-500 border border-red-500/20" : "hover:bg-gray-900 text-gray-400 hover:text-gray-200"}`}
                    >
                        <Languages className="w-5 h-5" /> i18n Dictionary
                    </Link>
                </nav>
                <div className="p-4 border-t border-gray-800/50 bg-[#0a0a0a]">
                    <Link href={`/${locale}/dashboard`} className="flex items-center justify-center gap-3 p-3 rounded-lg bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-white transition-colors border border-gray-800 text-sm">
                        <ArrowLeft className="w-4 h-4" /> Exit to App
                    </Link>
                </div>
            </aside>

            {/* Main Command Canvas */}
            <main className="flex-1 overflow-y-auto relative">
                <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.02] pointer-events-none"></div>
                <div className="p-10 max-w-6xl mx-auto relative z-10">
                    {children}
                </div>
            </main>
        </div>
    );
}