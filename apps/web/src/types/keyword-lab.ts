// Defines the exact structure returned by Claude for the Keyword Lab module
export interface KeywordResult {
  id?: string;
  clusterKeywords: Array<{ keyword: string; intent: "informational" | "commercial" | "transactional" }>;
  seoOpportunities: Array<{ keyword: string; type: "long-tail" | "lsi" | "question"; format: string; competition: "low" | "medium" | "high" }>;
  aiOverviewKeywords: Array<{ keyword: string; reason: string }>;
  topicIdeas: Array<{ title: string; targetAudience: string; angle: string; format: "guide" | "comparison" | "case-study" | "listicle" | "tutorial" }>;
  tacticalTips: Array<{ tip: string; category: "on-page" | "technical" | "ai-optimization" }>;
}