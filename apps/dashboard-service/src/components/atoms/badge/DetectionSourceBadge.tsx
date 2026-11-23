import React from 'react';
import { useTranslation } from 'react-i18next';
import { Database } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';
import { AS_CHIP } from '@/components/atoms/appsec/styles';

export type DetectionSource = 'scanner' | 'osv' | string | null | undefined;

export interface DetectionSourceBadgeProps {
  detectionSource?: DetectionSource;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A container detection is either reported by the scanner pod
 * (Trivy's own database) or matched by CybeDefend against the OSV database
 * from the image's package inventory. Only the second kind gets a badge —
 * scanner reports are the norm and need no decoration.
 */
const DetectionSourceBadge: React.FC<DetectionSourceBadgeProps> = ({
  detectionSource,
  size = 'sm',
  className,
}) => {
  const { t } = useTranslation();

  if (detectionSource !== 'osv') return null;

  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const padding = size === 'sm' ? 'px-1.5' : 'h-6 px-2';
  const label = t('components.detectionSourceBadge.osv');
  const title = t('components.detectionSourceBadge.osvTooltip');

  return (
    <span
      className={cn(
        AS_CHIP,
        padding,
        textSize,
        'bg-sky-100 dark:bg-sky-900/30',
        'border border-sky-500/20 dark:border-sky-500/30',
        'text-sky-700 dark:text-sky-300',
        className,
      )}
      title={title}
      aria-label={title}
    >
      <Database className={iconSize} />
      {label}
    </span>
  );
};

export default DetectionSourceBadge;
