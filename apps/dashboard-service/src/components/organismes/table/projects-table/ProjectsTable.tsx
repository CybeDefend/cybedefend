import React from "react";
import { Project } from "../../../../server/interfaces/Project";
import Button from "../../../atoms/button/Button";
import SearchBox from "../../../atoms/search-box/SearchBox";
import Pagination from "../../../molecules/pagination/Pagination";
import NotFoundElement from "@/components/molecules/not-found-element/NotFoundElement";
import { Skeleton } from "@/components/atoms/skeleton/Skeleton";
import { useTranslation } from "react-i18next";

import { AS_PANEL, AS_TH, AS_TD, AS_TD_STRONG, AS_TR, AS_THEAD, AS_DIVIDE } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
interface ProjectsTableProps {
  projects: Project[];
  onManageProject: (id: string) => void;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onProjectsSearchChange: (query: string) => void;
  loading: boolean;
}

const ProjectsTable: React.FC<ProjectsTableProps> = ({
  projects,
  onManageProject,
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onProjectsSearchChange,
  loading,
}) => {
  const { t } = useTranslation();

  return (
    <div className="min-h-[calc(100vh-450px)] w-full max-w-full mx-auto flex flex-col">
      <div className={cn(AS_PANEL, "flex-1 flex flex-col overflow-hidden")}>
        <div className="px-4 py-3 sm:px-5 grid grid-cols-1 gap-3 md:flex md:justify-between md:items-center border-b border-zinc-200 dark:border-as-line">
          <div className="w-full md:w-1/3">
            <SearchBox
              onSearch={onProjectsSearchChange}
              placeholder={t('components.projectsTable.searchPlaceholder')}
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar">
          {loading ? (
            <div className="p-4">
              <Skeleton type="table" rows={10} columns={1} />
            </div>
          ) : (
            <table className={cn("min-w-full", AS_DIVIDE)}>
              <thead className={AS_THEAD}>
                <tr>
                  {[
                    t('components.projectsTable.name'),
                    t('components.projectsTable.createdAt'),
                    ""
                  ].map((header, index) => (
                    <th
                      key={index}
                      scope="col"
                      className={cn(AS_TH, "text-start")}
                    >
                      <span>
                        {header}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={cn(AS_DIVIDE, "flex-1")}>
                {projects.length > 0 ? (
                  projects.map((project) => (
                    <tr
                      className={AS_TR}
                      key={project.projectId}
                    >
                      <td className={cn(AS_TD, "whitespace-nowrap")}>
                        <span className={AS_TD_STRONG}>
                          {project.name}
                        </span>
                      </td>
                      <td className={cn(AS_TD, "whitespace-nowrap")}>
                        <span className="font-mono text-xs tabular-nums">
                          {project.createdAt}
                        </span>
                      </td>
                      <td className={cn(AS_TD, "py-1.5 whitespace-nowrap")}>
                        <Button
                          variant="white"
                          onClick={() => onManageProject(project.projectId)}
                        >
                          {t('components.projectsTable.manage')}
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-[13px] text-zinc-500 dark:text-zinc-400"
                    >
                      <NotFoundElement
                        title={t('components.projectsTable.noProjectsFound')}
                        description={t('components.projectsTable.noProjectsDescription')}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 sm:px-5 py-3 grid gap-3 md:flex md:items-center md:justify-between border-t border-zinc-200 dark:border-as-line">
          <div className="flex-grow flex justify-center">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={pageSize}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectsTable;
