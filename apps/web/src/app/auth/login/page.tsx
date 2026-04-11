// apps/web/src/app/auth/login/page.tsx
import LoginForm from "@/components/auth/LoginForm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = {
    title: "Sign In | ContentForge AI",
    description: "Sign in to your ContentForge AI account",
};

export default async function LoginPage() {
    // Check if user is already logged in, redirect to dashboard if true
    const session = await getServerSession(authOptions);

    if (session) {
        redirect("/dashboard");
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <LoginForm />
        </div>
    );
}