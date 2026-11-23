// ============================================================================
// ComplianceStatusBadge - Status badge for compliance status
// ============================================================================

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import { ComplianceStatus } from '@/server/interfaces/OrganizationCompliance';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';

interface ComplianceStatusBadgeProps {
  status: ComplianceStatus;
  size?: 'sm' | 'md';
  /** Kept for the callers; the dot now stands where the icon stood. */
  showIcon?: boolean;
  className?: string;
}

/*
  The status is a 6 px dot in the status colour
  and the word in ink, never a tinted pill. The colour still carries the
  information; the word reads in both themes.
*/
const statusConfig: Record<ComplianceStatus, { tone: string; labelKey: string }> = {
  Compliant: { tone: WORD_TONE.good, labelKey: 'pages.complianceOverview.status.compliant' },
  'Non-Compliant': { tone: WORD_TONE.bad, labelKey: 'pages.complianceOverview.status.nonCompliant' },
  Pending: { tone: WORD_TONE.warning, labelKey: 'pages.complianceOverview.status.pending' },
};

/**
 * ComplianceStatusBadge - Displays compliance status as dot + label
 */
const ComplianceStatusBadge: React.FC<ComplianceStatusBadgeProps> = ({
  status,
  size = 'sm',
  className,
}) => {
  const { t } = useTranslation();
  const config = statusConfig[status];

  // The status written in its own colour, no dot.
  return (
    <span className={cn('whitespace-nowrap font-medium', size === 'md' ? 'text-sm' : 'text-[13px]', config.tone, className)}>
      {t(config.labelKey, status)}
    </span>
  );
};

export default ComplianceStatusBadge;
