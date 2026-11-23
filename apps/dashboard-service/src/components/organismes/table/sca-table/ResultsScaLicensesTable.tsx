import React from 'react';
import { useParams } from 'react-router-dom';
import { LinkRow } from '@/components/atoms/link';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import NotFoundElement from '@/components/molecules/not-found-element/NotFoundElement';
import LicenseCategoryBadge from '@/components/atoms/badge/LicenseCategoryBadge';
import { LicenseSummaryResponse, LicenseSummaryItem } from '@/server/interfaces/Packages';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import { productHome, projectPath } from '@/utils/product';
import { AS_TD, AS_TH, AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import Badge from '@/components/atoms/badge/Badge';

interface ResultsScaLicensesTableProps {
  data: LicenseSummaryResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  selectedBranch?: string;
  packageType?: string[];
}

const ResultsScaLicensesTable: React.FC<ResultsScaLicensesTableProps> = ({
  data,
  loading,
  error,
  refresh,
  selectedBranch,
  packageType,
}) => {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();

  // The licence's AppSec page; the table is only rendered under a project
  // route, so the AppSec home is a guard, never a destination.
  const buildLicenseUrl = (spdxId: string) => {
    if (!projectId) return productHome('appsec');
    const params = new URLSearchParams();
    if (selectedBranch) params.set('branch', selectedBranch);
    if (packageType) packageType.forEach(p => params.append('packageType', p));
    const qs = params.toString();
    return `${projectPath('appsec', projectId, `sca/license/${encodeURIComponent(spdxId)}`)}${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="min-h-[calc(100vh-360px)] w-full max-w-full mx-auto flex flex-col">
      <div className="flex-1 flex flex-col bg-white border border-zinc-200 rounded-2xl overflow-hidden dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
        {/* Summary cards */}
        {!loading && data && (
          <div className="px-4 sm:px-5 py-3 border-b border-zinc-200 dark:border-as-line">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                label={t('components.resultsScaLicensesTable.permissive')}
                count={data.permissiveCount}
                tone={AS_WORD_TONE.good}
              />
              <SummaryCard
                label={t('components.resultsScaLicensesTable.weakCopyleft')}
                count={data.weakCopyleftCount}
                tone={AS_WORD_TONE.warning}
              />
              <SummaryCard
                label={t('components.resultsScaLicensesTable.strongCopyleft')}
                count={data.strongCopyleftCount}
                tone={AS_WORD_TONE.bad}
              />
              <SummaryCard
                label={t('components.resultsScaLicensesTable.unknown')}
                count={data.unknownCount}
                tone={AS_WORD_TONE.neutral}
              />
            </div>
            <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-300">
              {t('components.resultsScaLicensesTable.summary', {
                total: data.totalPackages,
                withLicense: data.packagesWithLicenses,
                withoutLicense: data.packagesWithoutLicenses,
              })}
            </div>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto custom-scrollbar bg-white dark:bg-as-surface">
          {loading ? (
            <div className="p-4">
              <Skeleton type="table" rows={8} columns={1} />
            </div>
          ) : error ? (
            <div className="p-4 text-red-500">{error}</div>
          ) : data && data.licenses.length > 0 ? (
            <table className="min-w-full divide-y divide-zinc-100 dark:divide-as-line">
              <thead className="bg-zinc-50/70 dark:bg-white/[0.02]">
                <tr>
                  <th className={AS_TH}>
                    {t('components.resultsScaLicensesTable.type')}
                  </th>
                  <th className={AS_TH}>
                    {t('components.resultsScaLicensesTable.licenseName')}
                  </th>
                  <th className={AS_TH}>
                    {t('components.resultsScaLicensesTable.severity')}
                  </th>
                  <th className={AS_TH}>
                    {t('components.resultsScaLicensesTable.packages')}
                  </th>
                  <th className={AS_TH}>
                    {t('components.resultsScaLicensesTable.riskDescription')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
                {data.licenses.map((license: LicenseSummaryItem) => (
                  <LinkRow
                    key={license.spdxId}
                    className="hover:bg-zinc-50 dark:hover:bg-white/[0.03] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary transition-colors duration-[120ms]"
                    to={buildLicenseUrl(license.spdxId)}
                  >
                    <td className={AS_TD}>
                      <LicenseCategoryBadge category={license.category} appearance="dot" />
                    </td>
                    <td className={AS_TD}>
                      <div className="flex flex-col">
                        <span className="font-medium">{license.spdxId}</span>
                        {license.name !== license.spdxId && (
                          <span className="text-xs text-zinc-500 dark:text-zinc-300">
                            {license.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={AS_TD}>
                      <RiskBadge risk={license.risk} />
                    </td>
                    <td className={AS_TD}>
                      <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-as-raised dark:text-zinc-300">
                        {license.count}
                      </span>
                    </td>
                    <td className={cn(AS_TD, 'max-w-md')}>
                      {license.riskDescription}
                    </td>
                  </LinkRow>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4">
              <NotFoundElement
                title={t('components.resultsScaLicensesTable.noLicensesFound')}
                description={t('components.resultsScaLicensesTable.noLicensesDescription')}
                buttonText={t('components.resultsScaLicensesTable.refresh')}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Internal sub-components ---

/* The figure in mono ink, the licence category's word in its colour (no dot). */
const SummaryCard: React.FC<{
  label: string;
  count: number;
  tone: string;
}> = ({ label, count, tone }) => (
  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-as-line dark:bg-white/[0.03]">
    <div className="flex items-center gap-2">
      <span className="font-mono text-2xl font-medium leading-7 tracking-[-0.03em] tabular-nums text-zinc-900 dark:text-zinc-50">{count}</span>
    </div>
    <div className={cn('text-xs mt-0.5', tone)}>{label}</div>
  </div>
);





const RiskBadge: React.FC<{ risk: string }> = ({ risk }) => {
  // The word in its risk colour (Badge's « dot » appearance, no dot).
  const config: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'default' }> = {
    NONE: { label: 'None', variant: 'success' },
    MEDIUM: { label: 'Medium', variant: 'warning' },
    HIGH: { label: 'High', variant: 'error' },
    UNKNOWN: { label: 'Unknown', variant: 'default' },
  };
  const c = config[risk] || config.UNKNOWN;
  return (
    <Badge variant={c.variant} size="sm" appearance="dot">
      {c.label}
    </Badge>
  );
};

export default ResultsScaLicensesTable;
