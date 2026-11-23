import React from 'react';
import { useTranslation } from 'react-i18next';

import type {
  PersonalAccessTokenView,
  PersonalAccessTokenUsage,
} from '../../../server/interfaces/PersonalAccessToken';
import Button from '../../../components/atoms/button/Button';
import { Skeleton } from '../../../components/atoms/skeleton/Skeleton';
import NotFoundElement from '../../../components/molecules/not-found-element/NotFoundElement';
import { Pen, Trash } from '@/components/atoms/icon/icons';

import { AS_PANEL, AS_PANEL_TITLE, AS_DIVIDE, AS_THEAD, AS_TH, AS_TR, AS_TD, AS_TD_STRONG, AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
interface PatTableProps {
  tokens: PersonalAccessTokenView[];
  loading: boolean;
  error: string | null;
  /**
   * Per-user PAT usage from the backend (current count + hard cap).
   * Optional for backwards compatibility — when missing, we synthesise
   * `current` from `tokens.length` and use the documented cap of 10.
   */
  usage?: PersonalAccessTokenUsage;
  /** A « Last used » column (the Community Edition knows it; the cloud does not). */
  showLastUsed?: boolean;
  onAdd: () => void;
  onDelete: (token: PersonalAccessTokenView) => void;
  /** Absent where tokens cannot be renamed (the Community Edition has no rename route). */
  onRename?: (token: PersonalAccessTokenView) => void;
}

const PatTable: React.FC<PatTableProps> = ({
  tokens,
  loading,
  error,
  usage,
  showLastUsed = false,
  onAdd,
  onDelete,
  onRename,
}) => {
  const { t } = useTranslation();

  const formatDate = (iso: string | null) => {
    const epochMs = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(epochMs) || epochMs <= 0) return t('pages.patPage.unavailable');
    return new Date(epochMs).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const isExpired = (expiresAt: string | null) => {
    const epochMs = expiresAt ? Date.parse(expiresAt) : NaN;
    if (!Number.isFinite(epochMs) || epochMs <= 0) return false;
    return epochMs < Date.now();
  };

  const formatExpiration = (expiresAt: string | null) => {
    if (!expiresAt || !(Date.parse(expiresAt) > 0)) return t('components.modal.createPat.never');
    if (isExpired(expiresAt)) return t('components.patTable.expired') || 'Expired';
    return formatDate(expiresAt);
  };

  // ── 10-PAT-per-user cap ─────────────────────────────────────────
  // The cap is enforced server-side (RESOURCE_EXHAUSTED). The UI just
  // mirrors it so the button appears disabled before the user even tries.
  const usageCurrent = usage?.current ?? tokens.length;
  const usageMax = usage?.max ?? 10;
  const isAtCap = usageCurrent >= usageMax;
  const columnCount = showLastUsed ? 5 : 4;

  return (
    <div className={cn(AS_PANEL, "w-full flex flex-col overflow-hidden")}>
      {/* Header */}
      <div className="px-4 py-3 sm:px-5 flex justify-between items-center gap-3 border-b border-zinc-200 dark:border-as-line">
        <div className="flex flex-col gap-1">
          <h2 className={AS_PANEL_TITLE}>
            {t('pages.patPage.title')}
          </h2>
          <p
            data-testid="pat-usage-indicator"
            className={`text-[13px] tabular-nums ${
              isAtCap
                ? 'text-red-600 dark:text-red-400 font-medium'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {`${usageCurrent}/${usageMax} ${t('components.patTable.usageLabel')}`}
          </p>
        </div>
        <span
          data-testid="pat-create-button-wrap"
          title={isAtCap ? t('components.patTable.capReached') : undefined}
        >
          <Button
            variant="secondary"
            onClick={onAdd}
            disabled={isAtCap}
          >
            {t('components.patTable.addToken')}
          </Button>
        </span>
      </div>

      {/* Table */}
      <div className="overflow-auto custom-scrollbar">
        <table className={cn("min-w-full", AS_DIVIDE)}>
          <thead className={AS_THEAD}>
            <tr>
              {[
                t('components.patTable.name'),
                t('components.patTable.expiration'),
                t('components.patTable.created'),
                ...(showLastUsed ? [t('components.patTable.lastUsed')] : []),
                '',
              ].map((header, index) => (
                <th key={index} scope="col" className={cn(AS_TH, "text-start")}>
                  <span>
                    {header}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={AS_DIVIDE}>
            {loading ? (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
                  <Skeleton type="table" rows={4} columns={1} />
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-4 py-8 text-center text-[13px] text-red-600 dark:text-red-400"
                >
                  {error}
                </td>
              </tr>
            ) : tokens.length > 0 ? (
              tokens.map((token) => (
                <tr
                  key={token.id}
                  className={AS_TR}
                >
                  <td className={cn(AS_TD, "whitespace-nowrap")}>
                    <span className={AS_TD_STRONG}>
                      {token.name}
                    </span>
                    {token.lastFour && (
                      <span className="ml-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {`…${token.lastFour}`}
                      </span>
                    )}
                  </td>
                  <td className={cn(AS_TD, "whitespace-nowrap")}>
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        isExpired(token.expiresAt)
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {formatExpiration(token.expiresAt)}
                    </span>
                  </td>
                  <td className={cn(AS_TD, "whitespace-nowrap")}>
                    <span className="font-mono text-xs tabular-nums">
                      {formatDate(token.createdAt)}
                    </span>
                  </td>
                  {showLastUsed && (
                    <td className={cn(AS_TD, "whitespace-nowrap")}>
                      <span className="font-mono text-xs tabular-nums">
                        {token.lastUsedAt ? formatDate(token.lastUsedAt) : t('components.patTable.neverUsed')}
                      </span>
                    </td>
                  )}
                  <td className={cn(AS_TD, "py-1.5 whitespace-nowrap text-right")}>
                    <div className="inline-flex items-center gap-1">
                      {onRename && (
                      <button
                        onClick={() => onRename(token)}
                        className={cn("relative inline-flex h-8 items-center gap-1.5 px-2.5 text-[13px] font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100 rounded-lg transition-colors duration-[120ms]", AS_FOCUS, AS_TOUCH)}
                        title={t('components.patTable.rename')}
                      >
                        <Pen className="h-4 w-4"  />
                        {t('components.patTable.rename')}
                      </button>
                      )}
                      <button
                        onClick={() => onDelete(token)}
                        className={cn("relative inline-flex h-8 items-center gap-1.5 px-2.5 text-[13px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors duration-[120ms]", AS_FOCUS, AS_TOUCH)}
                      >
                        <Trash className="h-4 w-4"  />
                        {t('components.modal.deletePat.title')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
                  <NotFoundElement
                    title={t('components.patTable.noTokens')}
                    description={t('components.patTable.noTokensDescription')}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-4 sm:px-5 py-3 border-t border-zinc-200 dark:border-as-line">
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
          <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
            {tokens.length}
          </span>{' '}
          {t('components.patTable.totalTokens')}
        </p>
      </div>
    </div>
  );
};

export default PatTable;
