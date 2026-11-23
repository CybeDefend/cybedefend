import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import usePackagesByLicense from '@/server/hooks/usePackagesByLicense';
import { getLicenseDescription } from '@/utils/data/licenseDescriptions';
import { assignPackageLicense, setPackageLicenseIgnored } from '@/server/services/resultService';
import { fetchLicenseClassifications } from '@/server/services/licenseService';
import Select, { Option } from '@/components/atoms/select/Select';
import Button from '@/components/atoms/button/Button';
import LicenseCategoryBadge from '@/components/atoms/badge/LicenseCategoryBadge';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import { cn } from '@/utils/function/utils';
import { RootState } from '@/server/store';
import { productHome, projectPath } from '@/utils/product';
import { AS_DOT_WORD, AS_FOCUS, AS_WORD_TONE, AS_PAGE_TITLE, AS_PANEL_TITLE, AS_TAG, AS_TD, AS_TD_STRONG, AS_TH, AS_TOUCH } from '@/components/atoms/appsec/styles';

/**
 * The risk of a licence read like every other status: the word written in
 * the risk colour (no dot), with no tinted, bordered pill
 * and no icon.
 */
const riskConfig: Record<string, { word: string }> = {
  NONE: { word: AS_WORD_TONE.good },
  MEDIUM: { word: AS_WORD_TONE.warning },
  HIGH: { word: AS_WORD_TONE.bad },
  UNKNOWN: { word: AS_WORD_TONE.neutral },
};

/** A cell of a package row stacked below `md`: the row carries the padding. */
const PHONE_CELL = 'max-md:p-0 max-md:first:pl-0 max-md:last:pr-0';

const LicenseDetailPage: React.FC = () => {
  const { projectId, spdxId } = useParams<{ projectId: string; spdxId: string }>();
  const [searchParams] = useSearchParams();
  const branch = searchParams.get('branch') || undefined;
  const packageTypeRaw = searchParams.getAll('packageType');
  const packageType = useMemo(() => packageTypeRaw, [packageTypeRaw.join(',')]);
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization,
  );

  const { data, loading, error, refresh } = usePackagesByLicense({
    projectId: projectId || '',
    spdxId: spdxId || '',
    branch,
    organizationId: selectedOrganization?.id,
    packageType: packageType.length > 0 ? packageType : undefined,
  });

  const licenseDesc = spdxId ? getLicenseDescription(spdxId) : null;
  const risk = riskConfig[data?.risk || 'UNKNOWN'] || riskConfig.UNKNOWN;
  const isUnknownLicense = data?.category === 'UNKNOWN';

  const [licenseOptions, setLicenseOptions] = useState<Option[]>([]);
  const [selectedLicenses, setSelectedLicenses] = useState<Map<string, string>>(new Map());
  const [assigning, setAssigning] = useState<string | null>(null);
  const [ignoring, setIgnoring] = useState<string | null>(null);

  const loadLicenseOptions = useCallback(async () => {
    if (!isUnknownLicense || !selectedOrganization?.id) return;
    try {
      const result = await fetchLicenseClassifications(selectedOrganization.id);
      setLicenseOptions(
        (result.licenses || [])
          .filter((l) => l.currentCategory !== 'UNKNOWN')
          .map((l) => ({ value: l.spdxId, label: `${l.spdxId} (${l.name})` })),
      );
    } catch {
      // Silently fail - select will just be empty
    }
  }, [isUnknownLicense, selectedOrganization?.id]);

  useEffect(() => {
    loadLicenseOptions();
  }, [loadLicenseOptions]);

  const handleAssignLicense = async (packageId: string) => {
    const spdxValue = selectedLicenses.get(packageId);
    if (!spdxValue || !projectId) return;
    setAssigning(packageId);
    try {
      await assignPackageLicense(projectId, packageId, spdxValue);
      toast.success(t('components.licenseDetailPage.assignSuccess'));
      setSelectedLicenses((prev) => {
        const next = new Map(prev);
        next.delete(packageId);
        return next;
      });
      refresh();
    } catch {
      toast.error(t('components.licenseDetailPage.assignError'));
    } finally {
      setAssigning(null);
    }
  };

  const handleToggleIgnore = async (packageId: string, currentlyIgnored: boolean) => {
    if (!projectId) return;
    setIgnoring(packageId);
    try {
      await setPackageLicenseIgnored(projectId, packageId, !currentlyIgnored);
      toast.success(
        t(currentlyIgnored
          ? 'components.licenseDetailPage.unignoreSuccess'
          : 'components.licenseDetailPage.ignoreSuccess'),
      );
      refresh();
    } catch {
      toast.error(t('components.licenseDetailPage.ignoreError'));
    } finally {
      setIgnoring(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-120px)] w-full max-w-6xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* Back button */}
      <Link
        to={projectId ? `${projectPath('appsec', projectId, 'sca')}?tab=licenses` : productHome('appsec')}
        className={`relative inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors duration-[120ms] w-fit ${AS_FOCUS} ${AS_TOUCH}`}
      >
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
          <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('components.licenseDetailPage.backToLicenses')}
      </Link>

      {loading ? (
        <div className="space-y-4">
          <Skeleton type="table" rows={6} columns={1} />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-800 dark:border-red-400/20 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      ) : data ? (
        <>
          {/* Header */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-6 dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className={AS_PAGE_TITLE}>
                  {data.name || data.spdxId}
                </h1>
                {data.name !== data.spdxId && (
                  <p className="font-mono text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">{data.spdxId}</p>
                )}
              </div>
              <div className="flex items-center gap-4">
                <LicenseCategoryBadge category={data.category} appearance="dot" />
                <span className={cn(AS_DOT_WORD, risk.word)} data-appearance="dot">
                  {t(`components.licenseDetailPage.risk.${data.risk}`)}
                </span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-6 dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
            <h2 className={cn(AS_PANEL_TITLE, 'mb-3 flex items-center gap-2')}>
              <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
              </svg>
              {t('components.licenseDetailPage.description')}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {licenseDesc ? licenseDesc.description[lang] : data.riskDescription}
            </p>
            {licenseDesc && (
              <a
                href={licenseDesc.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`relative inline-flex items-center gap-1 mt-4 text-sm font-medium text-secondary hover:underline dark:text-secondary-light ${AS_TOUCH}`}
              >
                {t('components.licenseDetailPage.viewFullText')}
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3h7v7M13 3L6 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </div>

          {/* Legal Risks, Obligations, Recommendations grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Legal Risks */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-6 dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
              <h2 className={cn(AS_PANEL_TITLE, 'mb-3 flex items-center gap-2')}>
                <svg className="w-4 h-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {t('components.licenseDetailPage.legalRisks')}
              </h2>
              {licenseDesc && licenseDesc.legalRisks && licenseDesc.legalRisks[lang].length > 0 ? (
                <ul className="space-y-3">
                  {licenseDesc.legalRisks[lang].map((risk, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                      <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-400" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="8" r="3" />
                      </svg>
                      <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              ) : isUnknownLicense ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('components.licenseDetailPage.unknownLegalRisks')}</p>
              ) : (
                <p className="text-sm text-green-700 dark:text-green-400">{t('components.licenseDetailPage.noLegalRisks')}</p>
              )}
            </div>

            {/* Obligations */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-6 dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
              <h2 className={cn(AS_PANEL_TITLE, 'mb-3 flex items-center gap-2')}>
                <svg className="w-4 h-4 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1zm-5 8.274l-.818 2.552c.25.112.526.174.818.174.292 0 .569-.062.818-.174L5 10.274zm10 0l-.818 2.552c.25.112.526.174.818.174.292 0 .569-.062.818-.174L15 10.274z" clipRule="evenodd" />
                </svg>
                {t('components.licenseDetailPage.obligations')}
              </h2>
              {licenseDesc && licenseDesc.obligations[lang].length > 0 &&
                licenseDesc.obligations[lang][0] !== 'No obligations.' &&
                licenseDesc.obligations[lang][0] !== 'Aucune obligation.' ? (
                <ul className="space-y-3">
                  {licenseDesc.obligations[lang].map((obligation, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                      <svg className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="8" r="3" />
                      </svg>
                      <span>{obligation}</span>
                    </li>
                  ))}
                </ul>
              ) : isUnknownLicense ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('components.licenseDetailPage.unknownObligations')}</p>
              ) : (
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                    <path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t('components.licenseDetailPage.noObligations')}
                </div>
              )}
            </div>

            {/* Recommendations */}
            <div className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-6 dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
              <h2 className={cn(AS_PANEL_TITLE, 'mb-3 flex items-center gap-2')}>
                <svg className="w-4 h-4 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                {t('components.licenseDetailPage.recommendations')}
              </h2>
              {licenseDesc && licenseDesc.recommendations && licenseDesc.recommendations[lang].length > 0 ? (
                <ul className="space-y-3">
                  {licenseDesc.recommendations[lang].map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                      <svg className="w-4 h-4 mt-0.5 shrink-0 text-blue-400" viewBox="0 0 16 16" fill="none">
                        <path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              ) : isUnknownLicense ? (
                <ul className="space-y-3">
                  {(t('components.licenseDetailPage.unknownRecommendations', { returnObjects: true }) as string[]).map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                      <svg className="w-4 h-4 mt-0.5 shrink-0 text-blue-400" viewBox="0 0 16 16" fill="none">
                        <path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {/* Packages table */}
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
            <div className="px-4 sm:px-5 py-3 border-b border-zinc-200 dark:border-as-line">
              <h2 className={cn(AS_PANEL_TITLE, 'flex items-center gap-2')}>
                <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838l-2.727 1.17 1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zm5.99 7.176A9.026 9.026 0 007 15.96v-4.5l1.555.667a3 3 0 002.25 0l6.196-2.655A11.164 11.164 0 0117 12.93c.094.346.17.696.228 1.05a1 1 0 01-.89.89c-2.35.282-4.274 1.385-5.647 2.703z" />
                </svg>
                {t('components.licenseDetailPage.packagesUsing', { count: data.totalCount, license: data.spdxId })}
              </h2>
            </div>
            <div className="overflow-auto custom-scrollbar">
              {/* Below `md` a row stacks (package first, the rest wrapped) instead of scrolling sideways. */}
              <table className="w-full divide-y divide-zinc-100 dark:divide-as-line max-md:block">
                <thead className="bg-zinc-50/70 dark:bg-white/[0.02] max-md:hidden">
                  <tr>
                    <th className={AS_TH}>
                      {t('components.licenseDetailPage.packageName')}
                    </th>
                    <th className={AS_TH}>
                      {t('components.licenseDetailPage.version')}
                    </th>
                    <th className={AS_TH}>
                      {t('components.licenseDetailPage.ecosystem')}
                    </th>
                    <th className={AS_TH}>
                      {t('components.licenseDetailPage.dependency')}
                    </th>
                    <th className={AS_TH}>
                      {t('components.licenseDetailPage.otherLicenses')}
                    </th>
                    {isUnknownLicense && (
                      <th className={AS_TH}>
                        {t('components.licenseDetailPage.assignLicense')}
                      </th>
                    )}
                    <th className={AS_TH}>
                      {t('components.licenseDetailPage.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-as-line max-md:block">
                  {data.packages.map((pkg, idx) => (
                    <tr key={`${pkg.packageName}-${pkg.packageVersion}-${idx}`} className={cn('hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors duration-[120ms] max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-2 max-md:px-4 max-md:py-3')}>
                      <td className={cn(AS_TD, pkg.isLicenseIgnored ? 'text-zinc-500 line-through decoration-zinc-300 dark:text-zinc-400 dark:decoration-zinc-600' : AS_TD_STRONG, PHONE_CELL, 'max-md:basis-full')}>
                        {pkg.packageName}
                      </td>
                      <td className={cn(AS_TD, PHONE_CELL)}>
                        {/* zinc-600 on the zinc-100 chip: zinc-500 there read 4.4:1 (rule 7). */}
                        <span className={cn('inline-flex h-5 items-center rounded-md px-1.5 font-mono text-xs bg-zinc-100 dark:bg-white/[0.06]', pkg.isLicenseIgnored ? 'text-zinc-600 dark:text-zinc-400' : 'text-zinc-700 dark:text-zinc-300')}>
                          {pkg.packageVersion}
                        </span>
                      </td>
                      <td className={cn(AS_TD, PHONE_CELL)}>
                        <span className={cn(AS_TAG, pkg.isLicenseIgnored && 'text-zinc-500 dark:text-zinc-400')}>
                          {pkg.ecosystem}
                        </span>
                      </td>
                      <td className={cn(AS_TD, PHONE_CELL)}>
                        {pkg.isTransitive ? (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 italic">{t('components.licenseDetailPage.transitive')}</span>
                        ) : (
                          <span className={cn('text-xs', pkg.isLicenseIgnored ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-700 dark:text-zinc-300')}>{t('components.licenseDetailPage.direct')}</span>
                        )}
                        {pkg.isDev && (
                          <span className={`${AS_TAG} ml-2`}>
                            DEV
                          </span>
                        )}
                      </td>
                      <td className={cn(AS_TD, PHONE_CELL)}>
                        {pkg.licenses.filter((l) => l !== spdxId).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {pkg.licenses
                              .filter((l) => l !== spdxId)
                              .map((l) => (
                                <span
                                  key={l}
                                  className={cn(AS_TAG, pkg.isLicenseIgnored && 'text-zinc-500 dark:text-zinc-400')}
                                >
                                  {l}
                                </span>
                              ))}
                          </div>
                        ) : null /* no licence: an empty cell, no dash */}
                      </td>
                      {isUnknownLicense && (
                        <td className={cn(AS_TD, PHONE_CELL)}>
                          <div className="flex items-center gap-2">
                            <div className="w-40">
                              <Select
                                options={licenseOptions}
                                value={selectedLicenses.get(pkg.id) || ''}
                                onChange={(value) =>
                                  setSelectedLicenses((prev) => {
                                    const next = new Map(prev);
                                    if (value) {
                                      next.set(pkg.id, value);
                                    } else {
                                      next.delete(pkg.id);
                                    }
                                    return next;
                                  })
                                }
                                placeholder={t('components.licenseDetailPage.selectLicense')}
                                searchable
                                searchPlaceholder={t('components.licenseDetailPage.searchLicense')}
                                compact
                                alignRight
                              />
                            </div>
                            <Button
                              variant="primary"
                              size="xs"
                              onClick={() => handleAssignLicense(pkg.id)}
                              disabled={!selectedLicenses.get(pkg.id) || assigning === pkg.id}
                              loading={assigning === pkg.id}
                            >
                              {t('components.licenseDetailPage.assign')}
                            </Button>
                          </div>
                        </td>
                      )}
                      <td className={cn(AS_TD, PHONE_CELL, 'max-md:ml-auto')}>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleToggleIgnore(pkg.id, pkg.isLicenseIgnored)}
                          disabled={ignoring === pkg.id}
                          loading={ignoring === pkg.id}
                        >
                          {pkg.isLicenseIgnored
                            ? t('components.licenseDetailPage.unignore')
                            : t('components.licenseDetailPage.ignore')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default LicenseDetailPage;
