// apps/web/src/app/api/auth/register/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@contentforge/database";
import bcrypt from "bcrypt";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: {
        email: email,
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }

    // Hash the password securely (Cost factor: 12 is enterprise standard)
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create the user in the database
    // Note: isVerified defaults to false per our Prisma schema
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash: hashedPassword,
      },
    });

    // Create a wallet/balance record for the new user
    await prisma.wallet.create({
      data: {
        userId: newUser.id,
        creditsAvailable: 100, // Give 100 free credits as a welcome bonus
      },
    });

    return NextResponse.json(
      { message: "User registered successfully", userId: newUser.id },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration Error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during registration" },
      { status: 500 }
    );
  }
}