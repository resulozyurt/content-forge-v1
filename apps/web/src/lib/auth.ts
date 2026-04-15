// apps/web/src/lib/auth.ts
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@contentforge/database"; 
import bcrypt from "bcrypt";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // Validate presence of credentials
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Missing credentials. Please enter both your email and password.");
        }

        // Query the database using the correct prisma instance
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        // Fail early if no user record is found
        if (!user) {
          throw new Error("No account found matching this email address.");
        }

        // Enforce the mandatory OTP email verification step before granting access
        if (!user.isVerified) {
          throw new Error("Account pending verification. Please check your inbox and verify your email address before logging in.");
        }

        // Cryptographically verify the provided password against the stored bcrypt hash
        const isPasswordCorrect = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        // Fail if the hash comparison is negative
        if (!isPasswordCorrect) {
          throw new Error("Incorrect password. Please try again.");
        }

        // If all checks pass, construct and return the user payload for the JWT token
        return {
          id: user.id,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    // Populate the JSON Web Token with essential user metadata upon creation or update
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
      }
      return token;
    },
    // Hydrate the client session object utilizing the data securely stored in the JWT
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
  pages: {
    // Designate the custom routing path for unauthorized access attempts
    signIn: "/auth/login", 
  },
  session: {
    // Utilize JSON Web Tokens for stateless, edge-compatible session management
    strategy: "jwt",
  },
  // Ensure cryptographic operations utilize the environment-injected secret key
  secret: process.env.NEXTAUTH_SECRET,
};