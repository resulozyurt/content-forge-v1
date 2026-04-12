// apps/web/src/app/api/admin/translations/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import fs from 'fs';
import path from 'path';

async function verifyAdminAccess() {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "ADMIN") {
        throw new Error("Unauthorized");
    }
}

export async function GET(req: Request) {
    try {
        await verifyAdminAccess();
        const locales = ['en', 'tr'];
        const data: any = {};
        
        // Sunucu üzerindeki JSON dosyalarını fiziksel olarak oku
        for (const loc of locales) {
            const filePath = path.join(process.cwd(), 'messages', `${loc}.json`);
            if (fs.existsSync(filePath)) {
                const fileData = fs.readFileSync(filePath, 'utf8');
                data[loc] = JSON.parse(fileData);
            } else {
                data[loc] = {};
            }
        }
        return NextResponse.json({ translations: data }, { status: 200 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        await verifyAdminAccess();
        const { locale, translations } = await req.json();
        
        // Değiştirilen JSON formatını fiziksel dosyaya üzerine yaz (Overwrite)
        const filePath = path.join(process.cwd(), 'messages', `${locale}.json`);
        fs.writeFileSync(filePath, JSON.stringify(translations, null, 2), 'utf8');
        
        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}