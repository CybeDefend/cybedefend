import React from "react";
import { ContainerDetectedPackage } from "@/server/interfaces/Packages";
import { Skeleton } from "@/components/atoms/skeleton/Skeleton";
import NotFoundElement from "@/components/molecules/not-found-element/NotFoundElement";
import Pagination from "@/components/molecules/pagination/Pagination";
import FilterBar, { FilterConfig } from "@/components/molecules/filter-bar/FilterBar";
import { useTranslation } from "react-i18next";
import { AS_TAG, AS_TD, AS_TH } from '@/components/atoms/appsec/styles';

interface ResultsContainerPackagesTableProps {
  packages: ContainerDetectedPackage[];
  totalPackages: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSearchQueryChange: (value: string) => void;
  loading: boolean;
  selectedClassType: string[];
  onClassTypeChange: (value: string[]) => void;
}

const ResultsContainerPackagesTable: React.FC<ResultsContainerPackagesTableProps> = ({
  packages, totalPackages, currentPage, totalPages, pageSize, pageSizeOptions,
  onPageChange, onPageSizeChange, onSearchQueryChange, loading,
  selectedClassType, onClassTypeChange
}) => {
  const { t } = useTranslation();

  // The filters use the same translation keys as the other tables.
  const classTypeOptions = [
    { label: t('components.resultsContainerTable.class.os'), value: "os-pkgs" },
    { label: t('components.resultsContainerTable.class.lang'), value: "lang-pkgs" },
  ];

  // Configure filters for FilterBar
  const filters: FilterConfig[] = [
    {
      id: 'classType',
      label: t('components.resultsContainerTable.class.type'),
      options: classTypeOptions,
      value: selectedClassType,
      onChange: onClassTypeChange,
    },
  ];

  return (
    <div className="min-h-[calc(100vh-420px)] w-full max-w-full mx-auto flex flex-col">
      <div className="flex-1 flex flex-col bg-white border border-zinc-200 rounded-2xl overflow-hidden dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
        <FilterBar
          filters={filters}
          onSearchChange={onSearchQueryChange}
          searchPlaceholder={t('components.resultsScaPackagesTable.searchPlaceholder')}
        />
        <div className="flex-1 overflow-auto custom-scrollbar">
          {loading ? <div className="p-4"><Skeleton type="table" rows={10} columns={4} /></div> :
            packages.length > 0 ? (
              <table className="min-w-full divide-y divide-zinc-100 dark:divide-as-line">
                <thead className="bg-zinc-50/70 dark:bg-white/[0.02]">
                  <tr>
                    <th className={AS_TH}>{t('common.package')}</th>
                    <th className={AS_TH}>{t('components.resultsScaPackagesTable.version')}</th>
                    <th className={AS_TH}>{t('components.resultsContainerTable.class.type')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
                  {packages.map((pkg) => {
                    const classTypeLabel = pkg.ecosystem === 'os-pkgs'
                      ? t('components.resultsContainerTable.class.os')
                      : t('components.resultsContainerTable.class.lang');

                    return (
                      <tr key={pkg.id}>
                        <td className={AS_TD}>
                          {pkg.packageName}
                        </td>
                        <td className={AS_TD}>{pkg.packageVersion}</td>
                        <td className={AS_TD}>
                          <span className={AS_TAG}>
                            {classTypeLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <NotFoundElement title={t('components.resultsScaPackagesTable.noPackagesFound')} description={t('components.resultsScaPackagesTable.noPackagesDescription')} />
            )}
        </div>
        {!loading && (
          <div className="px-4 sm:px-5 py-3 flex justify-between items-center border-t border-zinc-200 dark:border-as-line">
            <p className="text-sm text-zinc-500 dark:text-zinc-300">{t('components.resultsScaPackagesTable.showing', { count: packages.length, total: totalPackages })}</p>
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} pageSize={pageSize} totalItems={totalPackages} pageSizeOptions={pageSizeOptions} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultsContainerPackagesTable;