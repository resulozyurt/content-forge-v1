// apps/web/src/app/api/v2/generator/research/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next"; // DÜZELTİLDİ
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
    }

    const currentUserId = (session.user as any).id; // V1 TİP BYPASS'I EKLENDİ
    const body = await req.json();
    const { keyword, targetLanguage } = body;

    let brandContext = {
      isEnabled: false,
      brandName: "Our Company",
      competitorsToOutrank: [],
      callToAction: "Discover our solutions today.",
      tone: "Highly Professional, Data-Driven, Authoritative",
    };

    let availableInternalLinks: string[] = [];

    // Sitemap ve DB sorguları "Try-Catch" zırhına alındı. Çökse bile motor durmaz.
    try {
        const brandProfile = await prisma.brandProfile.findUnique({
            where: { userId: currentUserId }
        }) as any;

        if (brandProfile) {
            brandContext.isEnabled = true;
            brandContext.brandName = brandProfile.name || "Our Company";
            brandContext.callToAction = brandProfile.description || brandContext.callToAction;

            let activeSitemapUrl = brandProfile.sitemapUrl || brandProfile.sitemap || brandProfile.website || "";
            if (activeSitemapUrl && !activeSitemapUrl.includes('.xml')) {
                activeSitemapUrl = activeSitemapUrl.replace(/\/$/, '') + '/sitemap_index.xml';
            }

            if (activeSitemapUrl) {
                const tryFetchSitemap = async (url: string): Promise<string[]> => {
                    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                    if (!res.ok) return [];
                    const xml = await res.text();
                    const subSitemaps = Array.from(xml.matchAll(/<loc>(.*?\.xml.*?)<\/loc>/g)).map(m => m[1]);
                    if (subSitemaps.length > 0) {
                        const allLinks: string[] = [];
                        for (const sub of subSitemaps.slice(0, 2)) {
                            allLinks.push(...(await tryFetchSitemap(sub)));
                            if (allLinks.length > 50) break;
                        }
                        return allLinks;
                    }
                    return Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g)).map(m => m[1]).filter(u => !u.endsWith('.xml'));
                };

                let allLinks = await tryFetchSitemap(activeSitemapUrl);
                const isTurkish = targetLanguage?.includes('tr') || false;
                let filteredLinks = allLinks.filter(url => {
                    if (isTurkish) return url.includes('/tr/') || url.includes('-tr/') || !url.match(/\/(en|de|fr|es)\//i);
                    else return url.includes('/en/') || !url.match(/\/(tr|de|fr|es)\//i);
                });
                availableInternalLinks = (filteredLinks.length > 0 ? filteredLinks : allLinks).sort(() => 0.5 - Math.random());
            }
        }
    } catch (dbError: any) {
        console.error("[RESEARCH_DB_OR_SITEMAP_ERROR]", dbError.message);
        // Hata yutulur (Graceful Fail). Veritabanı/Sitemap kopsa bile üretim devam eder.
    }

    const safeKeyword = keyword || "Target Keyword";

    const researchBlueprint = {
      keyword: safeKeyword,
      language: targetLanguage || "en-US",
      brandGuidelines: brandContext,
      extractedContext: {
        topHeaders: ["Core Concepts", "Benefits", "Implementation", "Cost Analysis"],
        mandatoryEntities: [safeKeyword],
        availableInternalLinks,
      },
    };

    return NextResponse.json(researchBlueprint, { status: 200 });

  } catch (error: any) {
    console.error("[RESEARCH_AGENT_CRITICAL_ERROR]", error);
    // UI tarafına kapalı kutu "500" yerine spesifik hatayı gönderiyoruz
    return NextResponse.json({ error: error.message || "Unknown Research error" }, { status: 500 });
  }
}