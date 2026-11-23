import React from "react";
import { useTranslation } from "react-i18next";
import { Circle, ExclamationCircle, ShieldAlt, TriangleExclamation } from '@/components/atoms/icon/icons';
import { AS_PANEL_TITLE } from '@/components/atoms/appsec/styles';

interface RiskDistributionProps {
    highRiskProjects: number;
    mediumRiskProjects: number;
    lowRiskProjects: number;
    totalProjects: number;
}

/**
 * Risk level configuration with colors and icons
 */
const riskLevels = [
    {
        key: "high",
        icon: ExclamationCircle,
        color: "#ef4444",
        bgColor: "rgba(239, 68, 68, 0.12)",
    },
    {
        key: "medium",
        icon: TriangleExclamation,
        color: "#f59e0b",
        bgColor: "rgba(245, 158, 11, 0.12)",
    },
    {
        key: "low",
        icon: ShieldAlt,
        color: "#10b981",
        bgColor: "rgba(16, 185, 129, 0.12)",
    },
];

/**
 * RiskDistributionCard - Displays project risk distribution with visual indicators
 * Shows how many projects fall into each risk category
 */
const RiskDistributionCard: React.FC<RiskDistributionProps> = ({
    highRiskProjects,
    mediumRiskProjects,
    lowRiskProjects,
    totalProjects,
}) => {
    const { t } = useTranslation();

    const riskData = [
        { key: "high", count: highRiskProjects },
        { key: "medium", count: mediumRiskProjects },
        { key: "low", count: lowRiskProjects },
    ];

    return (
        <div className="w-full rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-as-line dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
            {/* Header */}
            <div className="mb-5 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center">
                    <ShieldAlt
                        className="h-5 w-5 text-zinc-500 dark:text-zinc-400"
                     />
                </div>
                <div>
                    <h3 className={AS_PANEL_TITLE}>
                        {t("pages.organizationOverview.riskDistribution.title")}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {totalProjects} {t("pages.organizationOverview.riskDistribution.projects", { count: totalProjects })}
                    </p>
                </div>
            </div>

            {/* Risk bars */}
            <div className="space-y-4">
                {riskData.map((risk, index) => {
                    const config = riskLevels[index];
                    const percentage = totalProjects > 0 ? (risk.count / totalProjects) * 100 : 0;

                    return (
                        <div key={risk.key} className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div
                                        className="flex h-7 w-7 items-center justify-center rounded-lg"
                                        style={{ backgroundColor: config.bgColor }}
                                    >
                                        <config.icon
                                            className="h-4.5 w-4.5"
                                            style={{ color: config.color }}
                                         />
                                    </div>
                                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                        {t(`pages.organizationOverview.riskDistribution.${risk.key}Risk`)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-50">
                                        {risk.count}
                                    </span>
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                        ({percentage.toFixed(0)}%)
                                    </span>
                                </div>
                            </div>

                            {/* Progress bar */}
                            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.06]">
                                <div
                                    className="absolute left-0 top-0 h-full rounded-full transition-all duration-500 ease-out"
                                    style={{
                                        width: `${percentage}%`,
                                        backgroundColor: config.color,
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Summary */}
            <div className="mt-5 flex items-center justify-center gap-4 rounded-lg bg-zinc-50 p-3 dark:bg-white/[0.03]">
                {riskData.map((risk, index) => {
                    const config = riskLevels[index];
                    return (
                        <div key={risk.key} className="flex items-center gap-1.5">
                            <Circle
                                className="h-2 w-2"
                                style={{ color: config.color }}
                             />
                            <span className="text-xs text-zinc-600 dark:text-zinc-400">
                                {risk.count} {t(`pages.organizationOverview.riskDistribution.${risk.key}`)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default RiskDistributionCard;
