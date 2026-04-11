// apps/web/src/app/[locale]/dashboard/generator/page.tsx
"use client";

import { useState } from "react";
import GeneratorConfig from "@/components/generator/GeneratorConfig";
import ResearchAccordion from "@/components/generator/ResearchAccordion";
import OutlineBuilder from "@/components/generator/OutlineBuilder"; // <-- OutlineBuilder eklendi
import { GeneratorConfigData, ResearchResultData, FinalOutlineData } from "@/types/generator"; // <-- FinalOutlineData eklendi

// Mimarimizin ana aşamaları
type GenerationStage = 'config' | 'research' | 'outline' | 'writing' | 'editor';

export default function GeneratorPage() {
    const [currentStage, setCurrentStage] = useState<GenerationStage>('config');
    const [activeConfig, setActiveConfig] = useState<GeneratorConfigData | null>(null);
    const [researchData, setResearchData] = useState<ResearchResultData | null>(null);
    const [finalOutline, setFinalOutline] = useState<FinalOutlineData | null>(null); // <-- Seçilen başlıkları ve kelimeleri tutacak state

    const handleStartResearch = (config: GeneratorConfigData) => {
        setActiveConfig(config);
        setCurrentStage('research');
    };

    const handleCompleteResearch = (data: ResearchResultData) => {
        setResearchData(data);
        setCurrentStage('outline'); // Aşama 3'e geçiş
        console.log("Stage 2 Complete. Data for Outline:", data);
    };

    // Aşama 3'ten Aşama 4'e (Üretim) geçişi sağlayan fonksiyon
    const handleGenerateArticle = (finalData: FinalOutlineData) => {
        setFinalOutline(finalData);
        setCurrentStage('writing'); // Aşama 4'e geçiş
        console.log("Stage 3 Complete. Starting Writing with:", finalData);
    };

    return (
        <div className="w-full max-w-6xl mx-auto pb-12">
            {currentStage === 'config' && (
                <div className="pt-8">
                    <GeneratorConfig onStartResearch={handleStartResearch} />
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

            {/* Eski yer tutucu metin yerine gerçek OutlineBuilder bileşenini koyduk */}
            {currentStage === 'outline' && researchData && (
                <div className="pt-8">
                    <OutlineBuilder
                        researchData={researchData}
                        onGenerateArticle={handleGenerateArticle}
                    />
                </div>
            )}

            {/* Aşama 4 (Writing) için yer tutucu alan */}
            {currentStage === 'writing' && (
                <div className="pt-8 text-center animate-in fade-in">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Stage 4: Writing Article & Generating Images...
                    </h2>
                    <p className="mt-2 text-gray-500 italic">
                        Python-based NLP & Image prompts are firing now.
                    </p>
                </div>
            )}
        </div>
    );
}