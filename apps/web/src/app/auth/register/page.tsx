// apps/web/src/app/auth/register/page.tsx
import RegisterForm from "@/components/auth/RegisterForm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = {
    title: "Sign Up | ContentForge AI",
    description: "Create your ContentForge AI account",
};

export default async function RegisterPage() {
    // If user is already logged in, they shouldn't see the register page
    const session = await getServerSession(authOptions);

    if (session) {
        redirect("/dashboard");
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <RegisterForm />
        </div>
    );
}