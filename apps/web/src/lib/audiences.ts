// apps/web/src/lib/audiences.ts
//
// Single source of truth for the "Target Audience" feature shared by the
// AI Generate pipeline and the Keyword Lab. The user picks an audience BEFORE
// generating; that choice is injected into every downstream Claude prompt so
// the output speaks to that specific reader (vocabulary, examples, depth,
// readability) instead of a generic "reader".
//
// Design note: every helper here returns "" when no audience is set, so the
// whole feature stays optional and fully backward compatible — a blank or
// legacy config produces the exact same prompts as before.

export interface AudiencePreset {
  value: string; // stable key stored in config / sent to APIs
  label: string; // shown in the dropdown
  persona: string; // the natural-language persona handed to Claude
}

// "custom" is a sentinel value: when selected, the UI reveals a free-text box
// and the user's own text becomes the effective audience.
export const CUSTOM_AUDIENCE_VALUE = "custom";

// Default audience for new sessions. Kept explicit so generations always target
// a sensible reader unless the user picks something more specific.
export const DEFAULT_AUDIENCE_VALUE = "general";

export const AUDIENCE_PRESETS: AudiencePreset[] = [
  {
    value: "general",
    label: "General readers / beginners",
    persona:
      "a broad, general audience that is new to the topic — assume little prior knowledge, define terms in plain words, and lead with everyday examples",
  },
  {
    value: "b2b_execs",
    label: "B2B decision-makers & executives",
    persona:
      "busy B2B decision-makers and executives — focus on business impact, ROI, and strategic trade-offs, and keep it concise and outcome-driven",
  },
  {
    value: "developers",
    label: "Developers & technical practitioners",
    persona:
      "developers and technical practitioners — assume strong technical fluency, use precise terminology, and include concrete implementation detail",
  },
  {
    value: "smb_owners",
    label: "Small business owners & founders",
    persona:
      "small business owners and founders — practical, cost-conscious, and time-poor; emphasize actionable steps they can apply without a large team",
  },
  {
    value: "marketers",
    label: "Marketing & content professionals",
    persona:
      "marketing and content professionals — speak their language (SEO, funnels, campaigns) and tie every point to a measurable marketing outcome",
  },
  {
    value: "enterprise",
    label: "Enterprise / IT buyers",
    persona:
      "enterprise and IT buyers — emphasize security, scale, compliance, integration, and total cost of ownership",
  },
  {
    value: "students",
    label: "Students & early-career",
    persona:
      "students and early-career readers — explanatory and encouraging, build concepts step by step, and connect theory to real-world practice",
  },
];

/**
 * Resolves the natural-language persona from a stored value plus an optional
 * custom string. Returns "" when nothing meaningful is set so callers can treat
 * the feature as fully optional.
 */
export function resolveAudiencePersona(
  audienceValue?: string | null,
  customAudience?: string | null
): string {
  const value = (audienceValue ?? "").trim();
  if (!value) return "";
  if (value === CUSTOM_AUDIENCE_VALUE) {
    return (customAudience ?? "").trim();
  }
  const preset = AUDIENCE_PRESETS.find((a) => a.value === value);
  return preset?.persona ?? "";
}

/**
 * Short human-readable label — for logs, meta, or lighter prompts. Falls back to
 * the custom text, then the raw value.
 */
export function resolveAudienceLabel(
  audienceValue?: string | null,
  customAudience?: string | null
): string {
  const value = (audienceValue ?? "").trim();
  if (!value) return "";
  if (value === CUSTOM_AUDIENCE_VALUE) return (customAudience ?? "").trim();
  const preset = AUDIENCE_PRESETS.find((a) => a.value === value);
  return preset?.label ?? value;
}

/**
 * Builds the prompt directive injected into Claude calls. Returns "" when no
 * audience is set so existing prompts are unchanged for legacy/blank flows.
 */
export function buildAudienceInstruction(
  audienceValue?: string | null,
  customAudience?: string | null
): string {
  const persona = resolveAudiencePersona(audienceValue, customAudience);
  if (!persona) return "";
  return `[TARGET AUDIENCE — WRITE FOR THIS READER]:
This content is written for ${persona}.
Match the vocabulary, examples, and level of detail to this exact reader. Every explanation, analogy, and recommendation must land for them specifically — never write for a generic "everyone".`;
}
