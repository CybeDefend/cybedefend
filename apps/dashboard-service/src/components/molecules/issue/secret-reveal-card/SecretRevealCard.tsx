import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/utils/function/utils';
import { useRevealSecret } from '@/server/hooks/useSecretActions';
import { AlertTriangle, Check, Eye, EyeSlash } from '@/components/atoms/icon/icons';
import { copyText } from '@/utils/copyText';
import { sensitive } from '@/utils/privacy/sensitive';

interface SecretRevealCardProps {
  projectId: string;
  vulnerabilityId: string;
  hasStoredValue: boolean;
}

const SecretRevealCard: React.FC<SecretRevealCardProps> = ({
  projectId,
  vulnerabilityId,
  hasStoredValue,
}) => {
  const { t } = useTranslation();
  const { data, loading, error, reveal, hide } = useRevealSecret(projectId, vulnerabilityId);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (data?.secret) {
      void copyText(data.secret).then((ok) => {
        if (!ok) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div
      className={cn(
        'rounded-2xl p-4',
        'bg-white dark:bg-as-surface',
        'border border-zinc-200 dark:border-as-line',
      )}
    >
      <h4
        className={cn(
          'font-medium text-zinc-800 dark:text-zinc-200 mb-3 text-sm flex items-center gap-2',
        )}
      >
        <Eye className="h-4 w-4 text-secondary dark:text-secondary-light"  />
        {t('pages.issuePage.secret.reveal.title')}
      </h4>

      {!hasStoredValue ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">
          {t('pages.issuePage.secret.reveal.notStored')}
        </p>
      ) : (
        <>
          {/* Warning */}
          <div
            className={cn(
              'flex items-start gap-2 mb-3 p-2 rounded-lg',
              'bg-amber-50 dark:bg-amber-900/20',
              'border border-amber-200 dark:border-amber-700/50',
            )}
          >
            <AlertTriangle
              className="text-amber-500 dark:text-amber-400 mt-0.5 shrink-0 text-xs"
             />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {t('pages.issuePage.secret.reveal.warning')}
            </p>
          </div>

          {/* Secret display or masked placeholder */}
          {data ? (
            <div className="mb-3">
              <div
                className={cn(
                  'flex items-center justify-between gap-2 px-3 py-2 rounded-lg',
                  'bg-zinc-100 dark:bg-as-raised',
                  'border border-zinc-200 dark:border-as-line-strong',
                )}
              >
                <code {...sensitive('secret')} className="font-mono text-sm text-zinc-800 dark:text-zinc-200 break-all flex-1">
                  {data.secret}
                </code>
                <button
                  onClick={handleCopy}
                  className={cn(
                    'shrink-0 text-xs px-2 py-1 rounded',
                    'bg-zinc-200 dark:bg-white/[0.1]',
                    'text-zinc-600 dark:text-zinc-300',
                    'hover:bg-zinc-300 dark:hover:bg-white/[0.09] transition-colors',
                  )}
                >
                  {copied ? <Check className="h-4 w-4" /> : t('common.copy')}
                </button>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                'flex items-center px-3 py-2 rounded-lg mb-3',
                'bg-zinc-100 dark:bg-as-raised',
                'border border-zinc-200 dark:border-as-line-strong',
              )}
            >
              <span className="font-mono text-sm text-zinc-500 dark:text-zinc-400 tracking-widest">
                {'•'.repeat(32)}
              </span>
            </div>
          )}

          {/* Rate limit error */}
          {error && error.status === 429 && (
            <p className="text-xs text-red-600 dark:text-red-400 mb-3">
              {t('pages.issuePage.secret.reveal.rateLimit')}
            </p>
          )}

          {/* Generic error */}
          {error && error.status !== 429 && (
            <p className="text-xs text-red-600 dark:text-red-400 mb-3">{t(error.key)}</p>
          )}

          {/* Action button */}
          {data ? (
            <button
              onClick={hide}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg',
                'bg-zinc-100 dark:bg-as-raised',
                'text-zinc-700 dark:text-zinc-300',
                'hover:bg-zinc-200 dark:hover:bg-white/[0.09] transition-colors',
                'border border-zinc-200 dark:border-as-line-strong',
              )}
            >
              <EyeSlash className="h-4 w-4"  />
              {t('pages.issuePage.secret.reveal.hide')}
            </button>
          ) : (
            <button
              onClick={reveal}
              disabled={loading}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg',
                'bg-secondary text-white',
                'hover:bg-secondary/90 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <Eye className="h-4 w-4"  />
              {loading ? '…' : t('pages.issuePage.secret.reveal.button')}
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default SecretRevealCard;
