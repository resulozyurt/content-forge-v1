// apps/web/src/components/dashboard/Sidebar.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import {
    LayoutDashboard,
    FileEdit,
    History,
    ChevronLeft,
    ChevronRight,
    Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
    { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
    { name: "AI Generator", href: "/dashboard/generator", icon: FileEdit },
    { name: "History", href: "/dashboard/history", icon: History },
];

export default function Sidebar() {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const pathname = usePathname();
    const locale = useLocale();

    return (
        <aside className={cn(
            "bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transition-all duration-300 flex flex-col relative",
            isCollapsed ? "w-20" : "w-64"
        )}>
            <div className="h-16 flex items-center px-6 border-b border-gray-200 dark:border-gray-800">
                <Sparkles className="h-8 w-8 text-blue-600 flex-shrink-0" />
                {!isCollapsed && <span className="ml-3 text-xl font-bold dark:text-white">ContentForge</span>}
            </div>

            <nav className="flex-1 px-3 py-4 space-y-1">
                {navigation.map((item) => {
                    const fullHref = `/${locale}${item.href}`;

                    // DÜZELTME: Overview (/dashboard) için KESİN eşleşme, diğerleri için alt yol eşleşmesi arıyoruz.
                    const isActive = item.href === '/dashboard'
                        ? pathname === fullHref
                        : pathname === fullHref || pathname.startsWith(fullHref + '/');

                    return (
                        <Link
                            key={item.name}
                            href={fullHref}
                            className={cn(
                                "flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all group",
                                isActive
                                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                            )}
                        >
                            <item.icon className={cn("h-5 w-5 flex-shrink-0", isActive ? "text-blue-600" : "group-hover:text-gray-900 dark:group-hover:text-white")} />
                            {!isCollapsed && <span className="ml-3 truncate">{item.name}</span>}
                        </Link>
                    );
                })}
            </nav>

            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="absolute -right-3 top-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-full p-1 hover:bg-gray-50 dark:hover:bg-gray-800 shadow-sm"
            >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
        </aside>
    );
}