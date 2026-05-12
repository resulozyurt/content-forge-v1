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

    // selectedKeywords, questions, gaps come from useContentEngine which passes
    // the ResearchAccordion data — inject them so the writer pipeline can use them
    const selectedKeywords: string[] = body.selectedKeywords || [];
    const questions: string[] = (body.questions || []).map((q: any) =>
      typeof q === "string" ? q : q.text || ""
    ).filter(Boolean);
    const gaps: string[] = body.gaps || [];

    // ── Pre-fetch authority citations once — writer reads from this pool ───
    // This replaces 2 Serper calls × N sections with a single call here.
    // Cost: 1 Serper query instead of 16 = ~$0.30 saved per article.
    let preFetchedCitations: Array<{ url: string; label: string }> = [];
    const STATIC_CITATION_FALLBACKS = [
      { url: "https://www.mckinsey.com/capabilities/operations/our-insights", label: "McKinsey & Company" },
      { url: "https://www.statista.com/topics/market-research", label: "Statista" },
      { url: "https://www.ibm.com/think/topics/ai-for-business", label: "IBM Institute for Business Value" },
      { url: "https://www.deloitte.com/global/en/about/press-room/deloitte-insights.html", label: "Deloitte Insights" },
      { url: "https://www.gartner.com/en/newsroom/press-releases", label: "Gartner" },
      { url: "https://hbr.org/topic/subject/strategy", label: "Harvard Business Review" },
      { url: "https://www.forbes.com/sites/forbesbusinesscouncil/", label: "Forbes Business Council" },
      { url: "https://nrf.com/blog", label: "NRF" },
      { url: "https://contentmarketinginstitute.com/articles/", label: "Content Marketing Institute" },
      { url: "https://moz.com/blog", label: "Moz" },
    ];

    const BLOCKED = ["reddit.com","quora.com","linkedin.com","facebook.com","twitter.com","pinterest.com","amazon.","youtube.com","g2.com"];
    const PREFERRED = ["hbr.org","mckinsey.com","deloitte.com","ibm.com","gartner.com","statista.com","nrf.com","osha.gov","contentmarketinginstitute.com","moz.com","hubspot.com","techcrunch.com","forbes.com","venturebeat.com"];

    try {
      const serperKey = process.env.SERPER_API_KEY;
      if (serperKey) {
        const citeRes = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: `${safeKeyword} research statistics data`, num: 10 }),
          signal: AbortSignal.timeout(6000),
        });
        if (citeRes.ok) {
          const results: any[] = (await citeRes.json()).organic || [];
          const clean = results.filter((r) => r.link && !BLOCKED.some((d) => r.link.toLowerCase().includes(d)));
          // Sort: preferred domains first
          clean.sort((a, b) => {
            const aP = PREFERRED.some((d) => a.link.toLowerCase().includes(d)) ? 0 : 1;
            const bP = PREFERRED.some((d) => b.link.toLowerCase().includes(d)) ? 0 : 1;
            return aP - bP;
          });
          preFetchedCitations = clean.slice(0, 10).map((r) => {
            try {
              const domain = new URL(r.link).hostname.replace(/^www\./, "");
              const label = domain.split(".").slice(0, -1).join(" ")
                .replace(/-/g, " ").split(" ")
                .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || domain;
              return { url: r.link, label };
            } catch { return { url: r.link, label: r.link }; }
          });
        }
      }
    } catch { /* silent fail — use static fallbacks */ }

    // Pad with static fallbacks if fewer than 10 results
    while (preFetchedCitations.length < 10) {
      preFetchedCitations.push(STATIC_CITATION_FALLBACKS[preFetchedCitations.length % STATIC_CITATION_FALLBACKS.length]);
    }

    const researchBlueprint = {
      keyword: safeKeyword,
      language: targetLanguage || "en-US",
      brandGuidelines: brandContext,
      selectedKeywords,
      questions,
      gaps,
      preFetchedCitations,
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