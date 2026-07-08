"use client";

import { ReactNode } from "react";

interface InfoTooltipProps {
    text: string;
    children: ReactNode;
    /** Optional width override, defaults to w-60 */
    widthClass?: string;
}

/**
 * Lightweight hover/focus tooltip used across Keyword Lab.
 * Pure Tailwind (no external lib): shows on hover and on keyboard focus,
 * so it stays accessible. `normal-case tracking-normal font-normal text-left`
 * reset any uppercase/tracking styles inherited from badge triggers.
 */
export default function InfoTooltip({ text, children, widthClass = "w-60" }: InfoTooltipProps) {
    return (
        <span className="relative inline-flex group/tip" tabIndex={0}>
            <span className="cursor-help inline-flex">{children}</span>
            <span
                role="tooltip"
                className={`pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 ${widthClass} rounded-lg bg-gray-900 dark:bg-gray-700 px-3 py-2 text-xs font-normal normal-case tracking-normal text-white text-left leading-relaxed shadow-lg z-50 opacity-0 invisible transition-opacity duration-150 group-hover/tip:opacity-100 group-hover/tip:visible group-focus-within/tip:opacity-100 group-focus-within/tip:visible`}
            >
                {text}
                {/* Arrow */}
                <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
            </span>
        </span>
    );
}
