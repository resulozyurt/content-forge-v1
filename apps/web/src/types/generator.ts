// apps/web/src/types/generator.ts

export type ContentType = 'blog_post' | 'pillar_page' | 'guide' | 'product_review' | 'service_page';
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
  targetLength: string;       
  enableBrandVoice: boolean;  
  targetAudience: string;
  wpSitemap?: string;         
  // === FIX: TYPESCRIPT BUILD HATASI İÇİN EKLENDİ ===
  customBrandName?: string;
  customBrandDesc?: string;
}

export const initialConfigData: GeneratorConfigData = {
  query: '',
  contentType: 'blog_post',
  language: 'en',
  model: 'claude-sonnet-4-6',
  depth: 'comprehensive',
  tone: 'professional',
  targetLength: '1000',
  enableBrandVoice: false,
  targetAudience: '',
  wpSitemap: '',
  customBrandName: '',
  customBrandDesc: ''
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
  config?: GeneratorConfigData; 
}

export type ContentBlockType = 'h2' | 'h3' | 'paragraph' | 'image' | 'seo_metadata';

export interface GeneratedBlock {
  id: string;
  type: ContentBlockType;
  content: any; 
  metadata?: any;
}