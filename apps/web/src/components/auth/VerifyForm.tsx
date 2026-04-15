// apps/web/src/components/auth/VerifyForm.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function VerifyForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const email = searchParams.get("email");

    const [code, setCode] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Ensure the verification route is accessed with a valid email context
    useEffect(() => {
        if (!email) {
            router.push("/auth/register");
        }
    }, [email, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            // Dispatch the OTP sequence for backend validation
            const response = await fetch("/api/auth/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, code }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "The verification sequence failed. Please check your code.");
            }

            // Retrieve the ephemeral credentials stashed during the initial registration step
            const pendingCreds = sessionStorage.getItem("pending_creds");

            if (pendingCreds) {
                const { password } = JSON.parse(pendingCreds);

                // Execute a silent sign-in to securely establish the user's session footprint
                const result = await signIn("credentials", {
                    email,
                    password,
                    redirect: false,
                });

                if (result?.error) {
                    // Fallback to manual authentication if the auto-login pipeline faults
                    router.push("/auth/login?verified=true");
                } else {
                    // Scrub the sensitive payload from browser memory immediately and proceed to the application
                    sessionStorage.removeItem("pending_creds");
                    router.push("/dashboard");
                }
            } else {
                // Failsafe for edge cases (e.g., user verified on a different device or cleared cache)
                router.push("/auth/login?verified=true");
            }
        } catch (err: any) {
            setError(err.message);
            setIsLoading(false);
        }
    };

    if (!email) return null;

    return (
        <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="space-y-2 text-center">
                <h1 className="text-3xl font-bold tracking-tight text-gray-900">Verify Identity</h1>
                <p className="text-sm text-gray-500">
                    We dispatched a 6-digit code to <span className="font-semibold text-gray-900">{email}</span>
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md border border-red-100">
                        {error}
                    </div>
                )}

                <div className="space-y-1">
                    <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                        Security Code
                    </label>
                    <input
                        id="code"
                        type="text"
                        maxLength={6}
                        required
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                        className="w-full px-3 py-4 text-center text-2xl tracking-[0.5em] font-mono border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        placeholder="000000"
                    />
                </div>

                <button
                    type="submit"
                    disabled={isLoading || code.length !== 6}
                    className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {isLoading ? "Authenticating..." : "Verify and Login"}
                </button>
            </form>

            <p className="text-center text-sm text-gray-600">
                <Link href="/auth/register" className="font-medium text-gray-500 hover:text-gray-700 transition-colors">
                    ← Return to registration
                </Link>
            </p>
        </div>
    );
}