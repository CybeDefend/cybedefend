import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';

interface EolOsBannerProps {
  osFamily?: string;
  osName?: string;
  /**
   * `block` (default): full-width alert for the image detail header.
   * `inline`: compact badge for a table row.
   */
  variant?: 'block' | 'inline';
  className?: string;
}

/**
 * An image built on an end-of-support-life base OS scans with ZERO
 * vulnerabilities because the distribution stopped publishing advisories.
 * "0" then means "detection impossible", not "clean" — the alert must be
 * impossible to miss, hence red rather than the amber used for stale data.
 */
const EolOsBanner: React.FC<EolOsBannerProps> = ({
  osFamily,
  osName,
  variant = 'block',
  className,
}) => {
  const { t } = useTranslation();

  if (variant === 'inline') {
    return (
      <span
        role="alert"
        className={cn(
          'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs font-medium',
          'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
          className,
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t('container.images.eolOs.badge')}
      </span>
    );
  }

  const os = [osFamily, osName].filter(Boolean).join(' ');

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]',
        'border-red-200 bg-red-50 dark:border-red-400/20 dark:bg-red-900/20',
        className,
      )}
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="font-medium text-red-800 dark:text-red-300">
          {t('container.images.eolOs.title')}
        </p>
        <p className="text-red-700 dark:text-red-300/80">
          {t('container.images.eolOs.description', { os })}
        </p>
      </div>
    </div>
  );
};

export default EolOsBanner;
