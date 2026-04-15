// apps/web/src/types/generator.ts

export type ContentType = 'blog_post' | 'pillar_page' | 'guide' | 'product_review' | 'service_page';
export type AIModel = 'claude-3-5-sonnet' | 'gpt-4o';
export type Language = 'en' | 'tr';
export type ContentDepth = 'standard' | 'comprehensive' | 'exhaustive';
export type Tone = 'professional' | 'casual' | 'educational' | 'persuasive' | 'authoritative';

// Frase benzeri ana konfigürasyon verimiz
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
  model: 'claude-3-5-sonnet',
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

export type ContentBlockType = 'h2' | 'h3' | 'paragraph' | 'image';

export interface GeneratedBlock {
  id: string;
  type: ContentBlockType;
  content: string;
  metadata?: any;
}