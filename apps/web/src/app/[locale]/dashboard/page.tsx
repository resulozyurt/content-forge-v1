// apps/web/src/app/dashboard/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";
import Link from "next/link";

export const metadata = {
    title: "Dashboard | ContentForge AI",
};

export default async function DashboardPage() {
    const session = await getServerSession(authOptions);

    // Fetch the wallet balance for the logged-in user
    const wallet = await prisma.wallet.findUnique({
        where: { userId: session?.user?.id },
    });

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            {/* Header Section */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white transition-colors">Welcome back</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 transition-colors">Here is an overview of your content generation activities.</p>
                </div>
                <Link
                    href="/dashboard/generator"
                    className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                    + Create New Content
                </Link>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {/* Credits Card */}
                <div className="bg-white dark:bg-gray-900 overflow-hidden shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 transition-colors">
                    <div className="p-5">
                        <div className="flex items-center">
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate transition-colors">Available Credits</p>
                                <p className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white transition-colors">{wallet?.creditsAvailable || 0}</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 px-5 py-3 border-t border-gray-200 dark:border-gray-800 transition-colors">
                        <div className="text-sm">
                            <Link href="#" className="font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 transition-colors">View billing history</Link>
                        </div>
                    </div>
                </div>

                {/* Documents Card */}
                <div className="bg-white dark:bg-gray-900 overflow-hidden shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 transition-colors">
                    <div className="p-5">
                        <div className="flex items-center">
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate transition-colors">Total Documents</p>
                                <p className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white transition-colors">0</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 px-5 py-3 border-t border-gray-200 dark:border-gray-800 transition-colors">
                        <div className="text-sm">
                            <Link href="/dashboard/history" className="font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 transition-colors">View all documents</Link>
                        </div>
                    </div>
                </div>

                {/* Status Card */}
                <div className="bg-white dark:bg-gray-900 overflow-hidden shadow-sm rounded-xl border border-gray-200 dark:border-gray-800 transition-colors">
                    <div className="p-5">
                        <div className="flex items-center">
                            <div className="flex-1">
                                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate transition-colors">Account Status</p>
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="flex h-3 w-3 relative">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                                    </span>
                                    <p className="text-lg font-semibold text-gray-900 dark:text-white transition-colors">Active</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800/50 px-5 py-3 border-t border-gray-200 dark:border-gray-800 transition-colors">
                        <div className="text-sm">
                            <span className="font-medium text-gray-500 dark:text-gray-400 transition-colors">NextAuth Protected</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}