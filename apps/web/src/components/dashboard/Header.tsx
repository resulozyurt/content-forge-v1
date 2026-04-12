// apps/web/src/components/dashboard/Header.tsx
"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, Bell, User, LogOut, Settings, ShieldCheck, Zap } from "lucide-react";
import { Menu, Transition } from "@headlessui/react";
import { Fragment, useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

export default function Header() {
    const { theme, setTheme } = useTheme();
    const { data: session } = useSession();

    // Hydration mismatch fix: Wait until the component is mounted on the client
    const [mounted, setMounted] = useState(false);

    // Ledger state for UI display
    const [credits, setCredits] = useState<number | null>(null);

    useEffect(() => {
        setMounted(true);

        // Fetch the initial wallet balance once the component mounts and session is active
        const fetchWalletBalance = async () => {
            if (session?.user) {
                try {
                    const response = await fetch('/api/user/wallet');
                    if (response.ok) {
                        const data = await response.json();
                        setCredits(data.creditsAvailable);
                    }
                } catch (error) {
                    console.error("[WALLET_SYNC_FAULT]: Failed to establish a connection to the billing ledger.");
                }
            }
        };

        fetchWalletBalance();
    }, [session]);

    return (
        <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-end px-8 space-x-4">

            {/* Dynamic Billing Badge */}
            {credits !== null && (
                <div className="flex items-center bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-3 py-1.5 rounded-full border border-indigo-100 dark:border-indigo-800/50 shadow-sm mr-2 transition-all cursor-default">
                    <Zap size={14} className="mr-1.5 fill-current" />
                    <span className="text-sm font-bold tracking-tight">{credits.toLocaleString()} Credits</span>
                </div>
            )}

            {/* Theme Toggle */}
            <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors flex items-center justify-center w-9 h-9"
                aria-label="Toggle Dark Mode"
            >
                {/* Only render the icon after the client has fully mounted to prevent hydration errors */}
                {mounted ? (
                    theme === "dark" ? <Sun size={20} /> : <Moon size={20} />
                ) : (
                    <div className="w-5 h-5" /> /* Invisible placeholder to prevent layout shift */
                )}
            </button>

            {/* Notifications */}
            <button className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg relative flex items-center justify-center w-9 h-9">
                <Bell size={20} />
                <span className="absolute top-2 right-2 h-2 w-2 bg-red-500 rounded-full border-2 border-white dark:border-gray-900"></span>
            </button>

            {/* User Dropdown */}
            <Menu as="div" className="relative">
                <Menu.Button className="flex items-center space-x-3 focus:outline-none">
                    <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shadow-inner">
                        {session?.user?.email?.[0].toUpperCase() || "U"}
                    </div>
                </Menu.Button>
                <Transition
                    as={Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                >
                    <Menu.Items className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg focus:outline-none overflow-hidden z-50">
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                            <p className="text-sm font-medium dark:text-white truncate">{session?.user?.email}</p>
                            <p className="text-xs text-gray-500 uppercase mt-1">{session?.user?.role}</p>
                        </div>
                        <div className="p-1">
                            {session?.user?.role === 'ADMIN' && (
                                <Menu.Item>
                                    {({ active }) => (
                                        <button className={cn("flex w-full items-center px-3 py-2 text-sm rounded-lg dark:text-gray-200", active ? "bg-gray-50 dark:bg-gray-800" : "")}>
                                            <ShieldCheck size={16} className="mr-3" /> Admin Panel
                                        </button>
                                    )}
                                </Menu.Item>
                            )}
                            <Menu.Item>
                                {({ active }) => (
                                    <button className={cn("flex w-full items-center px-3 py-2 text-sm rounded-lg dark:text-gray-200", active ? "bg-gray-50 dark:bg-gray-800" : "")}>
                                        <Settings size={16} className="mr-3" /> Settings
                                    </button>
                                )}
                            </Menu.Item>
                            <Menu.Item>
                                {({ active }) => (
                                    <button
                                        onClick={() => signOut()}
                                        className={cn("flex w-full items-center px-3 py-2 text-sm rounded-lg text-red-600 dark:text-red-400", active ? "bg-red-50 dark:bg-red-900/20" : "")}
                                    >
                                        <LogOut size={16} className="mr-3" /> Sign Out
                                    </button>
                                )}
                            </Menu.Item>
                        </div>
                    </Menu.Items>
                </Transition>
            </Menu>
        </header>
    );
}