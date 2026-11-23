import React from "react";
import { useTranslation } from "react-i18next";
import type { ScanSourceType } from "@/server/interfaces/Project";
import { Code, Github, MousePointer, Plug, Terminal } from '@/components/atoms/icon/icons';
// GitLab is a trademark, so it keeps its official mark rather than a redrawn one.
import { SiGitlab as Gitlab } from 'react-icons/si';
import { AS_CHIP } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
import { isKnownScanSource, scanSourceLabelKey } from '@/utils/scanSource';

interface ScanSourceBadgeProps {
    /** A plain string from the API: an unknown source reads « Other source ». */
    source: ScanSourceType | string | null | undefined;
    className?: string;
}

type SourceStyle = { icon: React.ComponentType<{ className?: string }>; bgColor: string; textColor: string };

const NEUTRAL: Omit<SourceStyle, 'icon'> = {
    bgColor: "bg-zinc-100 dark:bg-white/[0.06]",
    textColor: "text-zinc-700 dark:text-zinc-300",
};

const SOURCE_STYLES: Record<ScanSourceType, SourceStyle> = {
    manual: { icon: MousePointer, bgColor: "bg-blue-100 dark:bg-blue-900", textColor: "text-blue-700 dark:text-blue-300" },
    cli: { icon: Terminal, bgColor: "bg-purple-100 dark:bg-purple-900", textColor: "text-purple-700 dark:text-purple-300" },
    github: { icon: Github, ...NEUTRAL },
    gitlab: { icon: Gitlab, bgColor: "bg-orange-100 dark:bg-orange-900", textColor: "text-orange-700 dark:text-orange-300" },
    jetbrains: { icon: Code, ...NEUTRAL },
    vscode: { icon: Code, ...NEUTRAL },
};

/**
 * Badge component to display the source type of a scan: manual, CLI, GitHub,
 * GitLab, JetBrains and VS Code, and « Other source » for a value the API adds
 * later (`scanSourceLabelKey`).
 */
const ScanSourceBadge: React.FC<ScanSourceBadgeProps> = ({ source, className = "" }) => {
    const { t } = useTranslation();
    const config = isKnownScanSource(source) ? SOURCE_STYLES[source] : { icon: Plug, ...NEUTRAL };
    const Icon = config.icon;

    return (
        <span className={cn(AS_CHIP, config.bgColor, config.textColor, className)}>
            <Icon className="h-3.5 w-3.5" />
            <span>{t(scanSourceLabelKey(source))}</span>
        </span>
    );
};

export default ScanSourceBadge;
