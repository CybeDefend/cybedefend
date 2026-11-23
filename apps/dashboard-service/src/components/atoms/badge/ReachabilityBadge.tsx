import React from 'react';
import { Activity, FlaskConical, HelpCircle, PackageCheck, PackageX } from '@/components/atoms/icon/icons';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import { AS_CHIP, AS_TOOLTIP } from '@/components/atoms/appsec/styles';

type ReachabilityValue =
  | 'used'
  | 'unused'
  | 'potentially_used'
  | 'test_only'
  | 'unknown'
  | string;

interface ReachabilityBadgeProps {
  reachability?: ReachabilityValue | null;
  iconOnly?: boolean;
  tooltipPlacement?: 'top' | 'right';
}

const ReachabilityBadge: React.FC<ReachabilityBadgeProps> = ({
  reachability,
  iconOnly = true,
  tooltipPlacement = 'right',
}) => {
  const { t } = useTranslation();

  if (!reachability) return null;

  const config = (() => {
    switch (reachability) {
      case 'used':
        return {
          Icon: PackageCheck,
          label: t('pages.issuePage.sca.reachability.used'),
          className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
        };
      case 'unused':
        return {
          Icon: PackageX,
          label: t('pages.issuePage.sca.reachability.unused'),
          className: 'bg-zinc-100 text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-400',
        };
      case 'potentially_used':
        return {
          Icon: Activity,
          label: t('pages.issuePage.sca.reachability.potentially_used'),
          className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
        };
      case 'test_only':
        return {
          Icon: FlaskConical,
          label: t('pages.issuePage.sca.reachability.test_only'),
          className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
        };
      case 'unknown':
        return {
          Icon: HelpCircle,
          label: t('pages.issuePage.sca.reachability.unknown'),
          className: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
        };
      default:
        return {
          Icon: HelpCircle,
          label: reachability,
          className: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
        };
    }
  })();

  const Icon = config.Icon;
  const tooltipPosition =
    tooltipPlacement === 'right'
      ? 'left-full top-1/2 ml-2 -translate-y-1/2'
      : 'bottom-full left-1/2 mb-2 -translate-x-1/2';

  return (
    <span
      className={cn(
        'group relative',
        iconOnly ? 'inline-flex items-center justify-center rounded-md p-1 text-xs font-medium whitespace-nowrap' : cn(AS_CHIP, 'px-2'),
        config.className,
      )}
      title={config.label}
      aria-label={config.label}
    >
      <Icon className={iconOnly ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
      {!iconOnly && <span>{config.label}</span>}
      {iconOnly && (
        <span
          className={cn(
            'absolute whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50',
            AS_TOOLTIP,
            tooltipPosition,
          )}
        >
          {config.label}
        </span>
      )}
    </span>
  );
};

export default ReachabilityBadge;
