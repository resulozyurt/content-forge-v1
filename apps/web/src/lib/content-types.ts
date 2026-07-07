// apps/web/src/lib/content-types.ts
//
// Single source of truth for content-type behavior in the generation engine.
//
// Background: the UI lets the user pick a content type (Blog Post, Pillar Page,
// Ultimate Guide, Product Review, Service Page) and shows a "Production Strategy
// Blueprint" promising type-specific output. Until now that choice never
// reached the writer — every type produced the same generic article. This map
// turns each type into a concrete writer instruction so the engine actually
// delivers on the promise the UI already makes.
//
// Design note: these instructions BIAS the writing (tone, density, which
// formats to prefer) but are worded with "where the section allows" so they
// never hard-override the per-section requiredFormat assigned by the
// orchestrator. Content type colors HOW a section is written; it does not
// fight the format engine.

import type { ContentType } from "@/types/generator";

const ARCHETYPES: Record<ContentType, string> = {
  blog_post:
    `[CONTENT TYPE — BLOG POST]: Top-of-funnel, highly readable. Favor short paragraphs, relatable examples, and strong hooks. Keep a conversational-but-credible voice and prioritize flow over exhaustive depth.`,

  pillar_page:
    `[CONTENT TYPE — PILLAR PAGE]: This is an encyclopedic authority piece. Maximize information density and depth for this sub-topic: define key terms precisely, add specific data, and cover the angle thoroughly enough to read as a definitive reference. Where the section allows, prefer structured formats (tables, well-scoped lists) over thin prose.`,

  guide:
    `[CONTENT TYPE — ULTIMATE GUIDE]: Step-by-step, how-to framing. Where the section allows, present concrete, ordered actions (an <ol> or clearly sequenced steps) and practical checklists. Be instructional — the reader should be able to act on this section immediately.`,

  product_review:
    `[CONTENT TYPE — PRODUCT REVIEW]: Critical, evaluative framing. Where the section allows, include an HTML comparison table with concrete criteria (features / pros / cons / specs). Be specific and balanced first, then reach a clear judgement. If a brand is provided, position it as the strongest option using evidence — never hype.`,

  service_page:
    `[CONTENT TYPE — SERVICE PAGE]: High-converting sales copy. Punchy, benefit- and outcome-led, anchored on the customer's pain points. Use short, confident sentences. Lead with the problem the reader feels, then the outcome, and drive toward action rather than pure education.`,
};

/**
 * Returns the writer instruction block for a content type. Falls back to the
 * blog_post archetype for unknown/absent values so the writer prompt is never
 * left with an empty directive.
 */
export function getContentTypeInstruction(contentType?: string | null): string {
  const key = (contentType ?? "") as ContentType;
  return ARCHETYPES[key] ?? ARCHETYPES.blog_post;
}