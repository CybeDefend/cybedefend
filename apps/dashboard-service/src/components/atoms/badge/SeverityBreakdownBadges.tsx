import React from 'react';
import { cn } from '@/utils/function/utils';
import { SeverityBreakdown } from '@/server/interfaces/Vulnerability';
import Badge, { BadgeSize } from './Badge';
import SeverityCount from './SeverityCount';
import { useTranslation } from 'react-i18next';

interface SeverityBreakdownBadgesProps {
    breakdown: SeverityBreakdown;
    className?: string;
    size?: BadgeSize;
    /** Show only non-zero values */
    hideZero?: boolean;
    /** Show labels (Critical, High, etc.) or just numbers */
    showLabels?: boolean;
    /**
     * `pill` (default): today's four tinted chips. `dot`: one
     * `SeverityCount` chip per severity, the mono figure and its letter in
     * one soft unit, zeros a quiet zinc outline.
     */
    appearance?: 'pill' | 'dot';
}

const SeverityBreakdownBadges: React.FC<SeverityBreakdownBadgesProps> = ({
    breakdown,
    className,
    size = 'xs',
    hideZero = false,
    showLabels = true,
    appearance = 'pill',
}) => {
    const { t } = useTranslation();

    const severities = [
        { key: 'critical', value: breakdown.critical, variant: 'critical' as const, label: t('components.issueBadges.critical') },
        { key: 'high', value: breakdown.high, variant: 'high' as const, label: t('components.issueBadges.high') },
        { key: 'medium', value: breakdown.medium, variant: 'medium' as const, label: t('components.issueBadges.medium') },
        { key: 'low', value: breakdown.low, variant: 'low' as const, label: t('components.issueBadges.low') },
    ];

    const filteredSeverities = hideZero ? severities.filter(s => s.value > 0) : severities;

    if (filteredSeverities.length === 0) return null;

    if (appearance === 'dot') {
        return (
            <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
                {filteredSeverities.map(({ key, value, variant, label }) => (
                    <SeverityCount
                        key={key}
                        severity={variant}
                        count={value}
                        label={showLabels ? label : undefined}
                        title={`${value} ${label}`}
                        aria-label={`${value} ${label}`}
                    />
                ))}
            </div>
        );
    }

    return (
        <div className={cn('flex gap-1.5 flex-wrap', className)}>
            {filteredSeverities.map(({ key, value, variant, label }) => (
                <Badge key={key} variant={variant} size={size}>
                    <span className="font-medium tabular-nums">{value}</span>
                    {showLabels && ` ${label}`}
                </Badge>
            ))}
        </div>
    );
};

export default SeverityBreakdownBadges;
