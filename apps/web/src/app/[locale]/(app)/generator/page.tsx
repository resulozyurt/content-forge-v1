// apps/web/src/app/[locale]/(app)/generator/page.tsx
"use client";

import { useState, Suspense } from "react";
import GeneratorConfig from "@/components/generator/GeneratorConfig";
import ResearchAccordion from "@/components/generator/ResearchAccordion";
import OutlineBuilder from "@/components/generator/OutlineBuilder";
import LiveGeneration from "@/components/generator/LiveGeneration";
import ProseEditor from "@/components/generator/ProseEditor";
import {
    GeneratorConfigData,
    ResearchResultData,
    FinalOutlineData,
    GeneratedBlock
} from "@/types/generator";

type GenerationStage = 'config' | 'research' | 'outline' | 'writing' | 'editor';

export default function GeneratorPage() {
    const [currentStage, setCurrentStage] = useState<GenerationStage>('config');
    const [activeConfig, setActiveConfig] = useState<GeneratorConfigData | null>(null);
    const [researchData, setResearchData] = useState<ResearchResultData | null>(null);
    const [finalOutline, setFinalOutline] = useState<FinalOutlineData | null>(null);
    const [articleBlocks, setArticleBlocks] = useState<GeneratedBlock[]>([]);

    const handleStartResearch = (config: GeneratorConfigData) => {
        setActiveConfig(config);
        setCurrentStage('research');
    };

    const handleCompleteResearch = (data: ResearchResultData) => {
        setResearchData(data);
        setCurrentStage('outline');
    };

    const handleGenerateArticle = (finalData: FinalOutlineData) => {
        setFinalOutline(finalData);
        setCurrentStage('writing');
    };

    const handleGenerationComplete = (blocks: GeneratedBlock[]) => {
        setArticleBlocks(blocks);
        setCurrentStage('editor');
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-12">
            {currentStage === 'config' && (
                <div className="pt-8">
                    {/* CRITICAL: Suspense boundary added to safely read URL parameters in child component */}
                    <Suspense fallback={<div className="flex justify-center p-12 text-gray-500 animate-pulse">Loading AI Engine configuration...</div>}>
                        <GeneratorConfig onStartResearch={handleStartResearch} />
                    </Suspense>
                </div>
            )}

            {currentStage === 'research' && activeConfig && (
                <div className="pt-8">
                    <ResearchAccordion
                        config={activeConfig}
                        onCompleteResearch={handleCompleteResearch}
                    />
                </div>
            )}

            {currentStage === 'outline' && researchData && (
                <div className="pt-8">
                    <OutlineBuilder
                        researchData={researchData}
                        activeConfig={activeConfig}
                        onGenerateArticle={handleGenerateArticle}
                    />
                </div>
            )}

            {currentStage === 'writing' && finalOutline && (
                <div className="pt-8">
                    <LiveGeneration
                        outlineData={finalOutline}
                        onComplete={handleGenerationComplete}
                    />
                </div>
            )}

            {currentStage === 'editor' && finalOutline && (
                <div className="pt-8">
                    <ProseEditor
                        blocks={articleBlocks}
                        outlineData={finalOutline}
                    />
                </div>
            )}
        </div>
    );
}