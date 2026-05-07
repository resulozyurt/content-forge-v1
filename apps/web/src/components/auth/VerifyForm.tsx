// apps/web/src/components/auth/VerifyForm.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2, MailCheck, ArrowRight, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

export default function VerifyForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const email = searchParams?.get("email");

    const [code, setCode] = useState(["", "", "", "", "", ""]);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    const [isLoading, setIsLoading] = useState(false);
    const [isResending, setIsResending] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    // Protect route if no email is provided
    useEffect(() => {
        if (!email) router.push('/auth/login');
    }, [email, router]);

    const handleInput = (index: number, value: string) => {
        if (!/^[0-9]*$/.test(value)) return;

        const newCode = [...code];
        newCode[index] = value;
        setCode(newCode);

        // Auto-focus next input
        if (value && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace" && !code[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData("text/plain").slice(0, 6);
        if (!/^[0-9]{6}$/.test(pastedData)) return;

        const newCode = pastedData.split("");
        setCode([...newCode, ...Array(6 - newCode.length).fill("")]);
        inputRefs.current[5]?.focus();
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        const otpString = code.join("");

        if (otpString.length !== 6) {
            setError("Please enter all 6 digits.");
            return;
        }

        setError("");
        setMessage("");
        setIsLoading(true);

        try {
            // MAGIC: Use NextAuth to verify AND login at the same time!
            const result = await signIn("credentials", {
                email,
                otp: otpString,
                isOtpLogin: "true",
                redirect: false
            });

            if (result?.error) {
                setError(result.error);
                setIsLoading(false);
            } else {
                setMessage("Verification successful! Logging you in...");
                router.push('/dashboard');
                router.refresh();
            }
        } catch (err: any) {
            setError("Authentication service unavailable.");
            setIsLoading(false);
        }
    };

    const handleResend = async () => {
        if (!email) return;
        setIsResending(true);
        setError("");
        setMessage("");

        try {
            // We can hit the register endpoint again with dummy data to trigger a resend, 
            // but a dedicated resend endpoint is cleaner. For now, hitting our generic API:
            const res = await fetch("/api/auth/resend-otp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email })
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error);
            setMessage("A new code has been sent to your email.");
        } catch (err: any) {
            setError(err.message || "Failed to resend code.");
        } finally {
            setIsResending(false);
        }
    };

    return (
        <div className="w-full max-w-md mx-auto space-y-6">
            <div className="text-center space-y-4 flex flex-col items-center">
                <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
                    <MailCheck className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Verify your email</h1>
                    <p className="text-gray-500 dark:text-gray-400 mt-2">
                        We've sent a 6-digit code to <span className="font-bold text-gray-700 dark:text-gray-200">{email}</span>
                    </p>
                </div>
            </div>

            <form onSubmit={handleVerify} className="space-y-6 mt-8">
                {error && (
                    <div className="p-3 text-sm text-center text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-800">
                        {error}
                    </div>
                )}
                {message && (
                    <div className="p-3 text-sm text-center text-green-600 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-100 dark:border-green-800">
                        {message}
                    </div>
                )}

                <div className="flex justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
                    {code.map((digit, index) => (
                        <input
                            key={index}
                            ref={(el) => { inputRefs.current[index] = el; }}
                            type="text"
                            inputMode="numeric"
                            maxLength={1}
                            value={digit}
                            onChange={(e) => handleInput(index, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(index, e)}
                            className="w-12 h-14 text-center text-2xl font-bold bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-all dark:text-white shadow-sm"
                        />
                    ))}
                </div>

                <button
                    type="submit"
                    disabled={isLoading || code.join("").length !== 6}
                    className={cn(
                        "w-full flex items-center justify-center py-3 px-4 rounded-xl text-white font-bold transition-all shadow-md",
                        isLoading || code.join("").length !== 6 ? "bg-gray-300 dark:bg-gray-700 cursor-not-allowed" : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 hover:scale-[1.02]"
                    )}
                >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ArrowRight className="w-5 h-5 mr-2" /> Verify & Continue</>}
                </button>
            </form>

            <div className="text-center pt-4 border-t border-gray-100 dark:border-gray-800">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    Didn't receive the code?
                </p>
                <button
                    onClick={handleResend}
                    disabled={isResending}
                    className="mt-2 text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center justify-center w-full gap-1.5"
                >
                    {isResending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
                    Resend Code
                </button>
            </div>
        </div>
    );
}