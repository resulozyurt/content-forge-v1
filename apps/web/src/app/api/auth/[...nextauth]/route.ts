// apps/web/src/app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@contentforge/database";
import bcrypt from "bcryptjs";

export const authOptions = {
    providers: [
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "text" },
                password: { label: "Password", type: "password" },
                otp: { label: "OTP", type: "text" },
                isOtpLogin: { label: "Is OTP Login", type: "text" }
            },
            async authorize(credentials) {
                if (!credentials?.email) throw new Error("Email is required.");

                const user = await prisma.user.findUnique({
                    where: { email: credentials.email },
                });

                if (!user) throw new Error("No user found with this email.");

                // ==========================================
                // PATH 1: AUTO-LOGIN VIA OTP (Post-Registration)
                // ==========================================
                if (credentials.isOtpLogin === "true") {
                    if (!credentials.otp) throw new Error("Verification code is required.");
                    
                    if (user.otpCode !== credentials.otp) {
                        throw new Error("Invalid verification code.");
                    }
                    
                    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
                        throw new Error("Verification code has expired.");
                    }

                    // OTP is valid. Mark user as verified, clear OTP data.
                    await prisma.user.update({
                        where: { id: user.id },
                        data: { 
                            isVerified: true, 
                            otpCode: null, 
                            otpExpiresAt: null 
                        }
                    });

                    return { id: user.id, email: user.email, name: user.name, role: user.role };
                }

                // ==========================================
                // PATH 2: STANDARD LOGIN VIA PASSWORD
                // ==========================================
                if (!credentials.password) throw new Error("Password is required.");

                if (!user.passwordHash) {
                    throw new Error("Invalid login method. Try social login.");
                }

                const isPasswordValid = await bcrypt.compare(credentials.password, user.passwordHash);
                
                if (!isPasswordValid) {
                    throw new Error("Incorrect password.");
                }

                if (!user.isVerified) {
                    throw new Error("Please verify your email address before logging in.");
                }

                return { id: user.id, email: user.email, name: user.name, role: user.role };
            }
        })
    ],
    pages: {
        signIn: '/auth/login',
        error: '/auth/login', // Error code passed in query string as ?error=
    },
    callbacks: {
        async jwt({ token, user }: any) {
            if (user) {
                token.role = user.role;
                token.id = user.id;
            }
            return token;
        },
        async session({ session, token }: any) {
            if (token && session.user) {
                session.user.role = token.role;
                session.user.id = token.id;
            }
            return session;
        }
    },
    session: {
        strategy: "jwt" as const,
    },
    secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };