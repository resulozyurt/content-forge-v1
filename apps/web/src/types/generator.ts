// apps/web/src/types/generator.ts

export type ContentType = 'blog_post' | 'pillar_page' | 'guide' | 'product_review' | 'service_page';

// FIX 1: Enforced strict model naming based on global rules
export type AIModel = 'claude-sonnet-4-6' | 'gpt-4o'; 

export type Language = 'en' | 'tr';
export type ContentDepth = 'standard' | 'comprehensive' | 'exhaustive';
export type Tone = 'professional' | 'casual' | 'educational' | 'persuasive' | 'authoritative';

export interface GeneratorConfigData {
  query: string;
  topic?: string;
  contentType: ContentType;
  language: Language;
  model: AIModel;
  depth: ContentDepth;
  tone: Tone;
  targetAudience: string;
}

export const initialConfigData: GeneratorConfigData = {
  query: '',
  contentType: 'blog_post',
  language: 'en',
  model: 'claude-sonnet-4-6', // Updated to reflect strict rule
  depth: 'comprehensive',
  tone: 'professional',
  targetAudience: '',
};

export interface CompetitorData {
  id: string;
  url: string;
  title: string;
  wordCount: number;
  selected: boolean;
  headings?: { level: string; text: string }[];
}

export interface ResearchResultData {
  intent: string;
  keywords: { text: string; selected: boolean }[];
  competitors: CompetitorData[];
  questions: { text: string; selected: boolean }[];
  gaps?: string[];
}

export interface OutlineHeading {
  id: string;
  text: string;
  level: 'h2' | 'h3';
}

export interface FinalOutlineData {
  headings: OutlineHeading[];
  selectedKeywords: string[];
  sourceUrls?: string[];
}

// FIX 2: Added 'seo_metadata' to the union type to resolve strict type checking fault
export type ContentBlockType = 'h2' | 'h3' | 'paragraph' | 'image' | 'seo_metadata';

export interface GeneratedBlock {
  id: string;
  type: ContentBlockType;
  content: any; // Adjusted to 'any' to safely accommodate both string blocks and JSON objects (like SEO data)
  metadata?: any;
}