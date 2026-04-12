// apps/web/src/app/[locale]/dashboard/admin/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Users, Zap, UserPlus, ArrowUpCircle, Loader2, AlertTriangle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserRecord {
    id: string;
    email: string;
    role: string;
    isVerified: boolean;
    createdAt: string;
    wallet: { creditsAvailable: number } | null;
}

export default function AdminDashboardPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [users, setUsers] = useState<UserRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // 1. Enforce rigorous client-side administrative shielding
    useEffect(() => {
        if (status === "loading") return;

        if (!session || (session.user as any).role !== "ADMIN") {
            router.push("/dashboard"); // Redirect unauthorized personnel immediately
            return;
        }

        fetchUsers();
    }, [session, status, router]);

    const fetchUsers = async () => {
        try {
            const res = await fetch("/api/admin/users");
            if (res.ok) {
                const data = await res.json();
                setUsers(data.users);
            }
        } catch (error) {
            console.error("[ADMIN_UI_FAULT] Failed to establish secure connection to the registry.", error);
        } finally {
            setIsLoading(false);
        }
    };

    // 2. Dispatch administrative override commands to the backend
    const executeAdminAction = async (targetUserId: string, action: string, payload: any) => {
        if (!confirm("Are you certain you want to execute this administrative override?")) return;

        setActionLoading(targetUserId);
        try {
            const res = await fetch("/api/admin/users", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetUserId, action, payload })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Operation failed.");
            }

            // Silently refresh the local data matrix to reflect the new state
            await fetchUsers();
        } catch (error: any) {
            alert(`Override Fault: ${error.message}`);
        } finally {
            setActionLoading(null);
        }
    };

    if (isLoading || status === "loading") {
        return (
            <div className="flex h-[600px] w-full items-center justify-center">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">

            {/* Command Center Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight flex items-center gap-3">
                        <ShieldCheck className="w-8 h-8 text-indigo-600" />
                        Command Center
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">Global oversight of the user registry, privilege escalation, and token economics.</p>
                </div>

                <div className="flex items-center gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-2 shadow-sm">
                    <Users className="w-5 h-5 text-blue-500" />
                    <div>
                        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Total Active Users</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white leading-none">{users.length}</p>
                    </div>
                </div>
            </div>

            {/* Global User Registry Table */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 uppercase text-xs font-bold tracking-widest border-b border-gray-200 dark:border-gray-800">
                            <tr>
                                <th className="px-6 py-4">Account Origin</th>
                                <th className="px-6 py-4">Security Privilege</th>
                                <th className="px-6 py-4">Network Status</th>
                                <th className="px-6 py-4">Token Ledger</th>
                                <th className="px-6 py-4 text-right">Administrative Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {users.map((user) => (
                                <tr key={user.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-gray-900 dark:text-white">{user.email}</span>
                                            <span className="text-xs text-gray-500 mt-0.5">Joined: {new Date(user.createdAt).toLocaleDateString()}</span>
                                        </div>
                                    </td>

                                    <td className="px-6 py-4">
                                        <span className={cn(
                                            "inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                                            user.role === "ADMIN"
                                                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800"
                                                : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                        )}>
                                            {user.role === "ADMIN" && <ShieldAlert className="w-3 h-3 mr-1" />}
                                            {user.role}
                                        </span>
                                    </td>

                                    <td className="px-6 py-4">
                                        {user.isVerified ? (
                                            <span className="text-green-600 dark:text-green-400 font-bold text-xs flex items-center gap-1.5">
                                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div> Verified
                                            </span>
                                        ) : (
                                            <span className="text-amber-600 dark:text-amber-400 font-bold text-xs flex items-center gap-1.5">
                                                <AlertTriangle className="w-3 h-3" /> Pending OTP
                                            </span>
                                        )}
                                    </td>

                                    <td className="px-6 py-4 font-bold text-gray-900 dark:text-white">
                                        <div className="flex items-center gap-1.5">
                                            <Zap className="w-4 h-4 text-blue-500" />
                                            {user.wallet?.creditsAvailable || 0}
                                        </div>
                                    </td>

                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">

                                            {/* Action: Add 50 Credits */}
                                            <button
                                                onClick={() => executeAdminAction(user.id, "ADD_CREDITS", { amount: 50 })}
                                                disabled={actionLoading === user.id}
                                                className="p-2 bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 dark:text-blue-400 rounded-lg transition-colors disabled:opacity-50"
                                                title="Inject 50 Tokens"
                                            >
                                                {actionLoading === user.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
                                            </button>

                                            {/* Action: Toggle Admin/User Role */}
                                            <button
                                                onClick={() => executeAdminAction(user.id, "UPDATE_ROLE", { role: user.role === "ADMIN" ? "USER" : "ADMIN" })}
                                                disabled={actionLoading === user.id}
                                                className={cn(
                                                    "p-2 rounded-lg transition-colors disabled:opacity-50 text-xs font-bold uppercase tracking-wider",
                                                    user.role === "ADMIN"
                                                        ? "bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/40 dark:text-red-400"
                                                        : "bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-300"
                                                )}
                                                title={user.role === "ADMIN" ? "Revoke Admin Privileges" : "Promote to Admin"}
                                            >
                                                {user.role === "ADMIN" ? "Demote" : "Promote"}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
}