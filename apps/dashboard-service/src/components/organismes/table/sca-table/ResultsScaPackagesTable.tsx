import React from "react";
import { Skeleton } from "@/components/atoms/skeleton/Skeleton";
import NotFoundElement from "../../../../components/molecules/not-found-element/NotFoundElement";
import Pagination from "../../../../components/molecules/pagination/Pagination";
import FilterBar, { FilterConfig } from "@/components/molecules/filter-bar/FilterBar";
import PackageTypeBadge from "../../../../components/atoms/badge/PackageTypeBadge";
import ReachabilityBadge from "@/components/atoms/badge/ReachabilityBadge";
import { ScaDetectedPackage } from "@/server/interfaces/Packages";
import { useTranslation } from "react-i18next";
import { AS_TD, AS_TH } from '@/components/atoms/appsec/styles';
import { EDITION } from '@/edition/edition';

/** A SARIF import carries no dependency analysis: the reachability badge is not rendered in the Community Edition. */
const SCANNER_ONLY_HIDDEN = EDITION === 'community';

interface ResultsScaPackagesTableProps {
  projectId: string | undefined;
  packages: ScaDetectedPackage[];
  totalPackages: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  selectedPackageType: string[];
  onPackageTypeChange: (value: string[]) => void;
  onSearchQueryChange: (value: string) => void;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  includeDevAndTest: boolean;
}

const ResultsScaPackagesTable: React.FC<ResultsScaPackagesTableProps> = ({
  projectId,
  packages,
  totalPackages,
  currentPage,
  totalPages,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  selectedPackageType,
  onPackageTypeChange,
  onSearchQueryChange,
  loading,
  error,
  refresh,
  includeDevAndTest,
}) => {
  const { t } = useTranslation();

  const allPackageTypeOptions = [
    { label: t('scaDependencies.direct'), value: "direct" },
    { label: t('scaDependencies.dev'), value: "dev" },
    { label: t('scaDependencies.transitive'), value: "transitive" },
  ];

  // All options when enabled, empty when disabled (since select is hidden)
  const packageTypeOptions = includeDevAndTest ? allPackageTypeOptions : [];

  // Configure filters for FilterBar
  const filters: FilterConfig[] = includeDevAndTest ? [
    {
      id: 'packageType',
      label: t('components.resultsScaTable.packageType'),
      options: packageTypeOptions,
      value: selectedPackageType,
      onChange: onPackageTypeChange,
    },
  ] : [];

  return (
    <div className="min-h-[calc(100vh-360px)] w-full max-w-full mx-auto flex flex-col">
      <div className="flex-1 flex flex-col bg-white border border-zinc-200 rounded-2xl overflow-hidden dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
        <FilterBar
          filters={filters}
          onSearchChange={onSearchQueryChange}
          searchPlaceholder={t('components.resultsScaPackagesTable.searchPlaceholder')}
        />
        <div className="flex-1 overflow-auto custom-scrollbar bg-white dark:bg-as-surface">
          {loading ? (
            <div className="p-4">
              <Skeleton type="table" rows={10} columns={1} />
            </div>
          ) : error ? (
            <div className="p-4 text-red-500">{error}</div>
          ) : packages.length > 0 ? (
            <table className="min-w-full divide-y divide-zinc-100 dark:divide-as-line">
              <thead className="bg-zinc-50/70 dark:bg-white/[0.02]">
                <tr>
                  <th className={AS_TH}>
                    {t('components.resultsScaPackagesTable.packageName')}
                  </th>
                  <th className={AS_TH}>
                    {t('components.resultsScaPackagesTable.version')}
                  </th>
                  <th className={AS_TH}>
                    {t('components.resultsScaPackagesTable.ecosystem')}
                  </th>
                  <th className={AS_TH}>
                    {t('components.resultsScaPackagesTable.createdAt')}
                  </th>
                  <th className={AS_TH}>
                    {t('components.resultsScaPackagesTable.updatedAt')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
                {packages.map((pkg) => (
                  <tr
                    key={pkg.id}
                    className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors duration-[120ms]"
                  >
                    <td className={AS_TD}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate" title={pkg.packageName}>{pkg.packageName}</span>
                        <PackageTypeBadge
                          library={{
                            id: pkg.id,
                            projectId: pkg.projectId,
                            packageName: pkg.packageName,
                            packageVersion: pkg.packageVersion,
                            fileName: pkg.fileName,
                            ecosystem: pkg.ecosystem,
                            isTransitive: pkg.isTransitive,
                            isDev: pkg.isDev,
                            path: pkg.path,
                            dependencyInfoAvailable: pkg.dependencyInfoAvailable
                          }}
                          compact={true}
                          iconOnly
                          tooltipPlacement="right"
                        />
                        {!SCANNER_ONLY_HIDDEN && <ReachabilityBadge reachability={pkg.reachability} />}
                      </div>
                      <div className="text-xs text-zinc-500 truncate dark:text-zinc-400" title={pkg.fileName}>
                        {pkg.fileName}
                      </div>
                    </td>
                    <td className={AS_TD}>
                      {pkg.packageVersion}
                    </td>
                    <td className={AS_TD}>
                      {pkg.ecosystem}
                    </td>
                    <td className={AS_TD}>
                      {new Date(pkg.createdAt).toLocaleDateString()}
                    </td>
                    <td className={AS_TD}>
                      {new Date(pkg.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4">
              <NotFoundElement
                title={t('components.resultsScaPackagesTable.noPackagesFound')}
                description={t('components.resultsScaPackagesTable.noPackagesDescription')}
                buttonText={t('components.resultsScaPackagesTable.refresh')}
              />
            </div>
          )}
        </div>
        {!loading && (
          <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-t border-zinc-200 dark:border-as-line bg-white dark:bg-as-surface">
            <p className="text-sm text-zinc-500 dark:text-zinc-300">
              {t('components.resultsScaPackagesTable.showing', { count: packages.length, total: totalPackages })}
            </p>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalPackages}
              pageSize={pageSize}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              pageSizeOptions={pageSizeOptions}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultsScaPackagesTable;
