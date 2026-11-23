import React from 'react';
import { useTranslation } from 'react-i18next';
import SeverityCount from '@/components/atoms/badge/SeverityCount';

interface IssueBadgesProps {
    countCritical: number;
    countHigh: number;
    countMedium: number;
    countLow: number;
}

/** Worst first, matching the ring on the dashboard KPI card. */
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

/**
 * Severity counts for a project row: each count one soft chip in its
 * severity's tint, the figure in mono ink, the initial after it in the
 * severity's colour. The column is narrow, so the visible
 * label stays the single-letter form (`C`, `H`, `M`, `L`) — but the full
 * severity name travels with it as `title` and `aria-label`, because an
 * initial no one can decode is not a label. A zero keeps its place, faded, so
 * the four counts align from one row to the next.
 */
const IssueBadges: React.FC<IssueBadgesProps> = ({ countCritical, countHigh, countMedium, countLow }) => {
    const { t } = useTranslation();

    const counts: Record<(typeof SEVERITIES)[number], number> = {
        critical: countCritical,
        high: countHigh,
        medium: countMedium,
        low: countLow,
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {SEVERITIES.map((severity) => {
                const fullLabel = `${counts[severity]} ${t(`common.severity.${severity}`)}`;
                return (
                    <SeverityCount
                        key={severity}
                        severity={severity}
                        count={counts[severity]}
                        label={t(`components.issueBadges.${severity}`)}
                        title={fullLabel}
                        aria-label={fullLabel}
                    />
                );
            })}
        </div>
    );
};

export default IssueBadges;
