import React, { useState } from "react";
import { APIKey } from "../../../../server/interfaces/ApiKey";
import Button from "../../../atoms/button/Button";
import SearchBox from "../../../atoms/search-box/SearchBox";
import { Skeleton } from "../../../atoms/skeleton/Skeleton";
import NotFoundElement from "../../../molecules/not-found-element/NotFoundElement";
import Pagination from "../../../molecules/pagination/Pagination";
import CreateAPIKeyModal from "../../../molecules/modal/create-api-key-modal/CreateAPIKeyModal";
import { isExpiringIn } from "@/utils/function/utils";
import { isPast } from "date-fns";
import { useTranslation } from "react-i18next";

interface APIKeyTableProps {
  apiKeys: APIKey[];
  totalKeys: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  title: string;
  onSearchChange: (query: string) => void;
  onAddAPIKey: (
    name: string,
    description: string,
    expirationDate: string | null,
    authorizedIps: string[]
  ) => void;
  onCopyKey: (key: string) => void;
  onManageAPIKey: (id: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const APIKeyTable: React.FC<APIKeyTableProps> = ({
  apiKeys,
  totalKeys,
  currentPage,
  totalPages,
  pageSize,
  loading,
  error,
  title,
  onSearchChange,
  onAddAPIKey,
  onCopyKey,
  onManageAPIKey,
  onPageChange,
  onPageSizeChange,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const { t } = useTranslation();

  const handleAddKey = () => {
    setShowAddModal(true);
  };

  const handleCreateAPIKey = (
    name: string,
    description: string,
    expirationDate: string | null,
    authorizedIps: string[]
  ) => {
    onAddAPIKey(name, description, expirationDate, authorizedIps);
    setShowAddModal(false);
  };

  return (
    <div className="min-h-[calc(100vh-280px)] w-full max-w-full mx-auto flex flex-col">
      <div className="flex-1 flex flex-col bg-white border border-gray-200 rounded-lg shadow overflow-hidden dark:bg-neutral-800 dark:border-neutral-700">
        <div className="px-6 py-4 grid gap-3 md:flex md:justify-between md:items-center border-b border-gray-200 dark:border-neutral-700">
            <div className="flex items-center gap-x-4">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white whitespace-nowrap">{title}</h2>
            <SearchBox onSearch={onSearchChange} />
            </div>
          <div>
            <div className="inline-flex gap-x-2">
              <Button variant="secondary" onClick={handleAddKey}>
                {t('components.apiKeyTable.addApiKey')}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-neutral-700">
            <thead className="bg-alternative dark:bg-neutral-800">
              <tr>
                {[
                  t('components.apiKeyTable.name'),
                  t('components.apiKeyTable.description'),
                  t('components.apiKeyTable.apiKey'),
                  t('components.apiKeyTable.expiration'),
                  t('components.apiKeyTable.created'),
                  "",
                ].map((header, index) => (
                  <th key={index} scope="col" className="px-6 py-3 text-start">
                    <span className="text-xs uppercase tracking-wide text-black dark:text-gray-300">
                      {header}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200 dark:divide-neutral-700 dark:bg-neutral-800 flex-1">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center">
                    <Skeleton type="table" rows={10} columns={1} />
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-4 text-center text-red-500 dark:text-red-400"
                  >
                    {error}
                  </td>
                </tr>
              ) : apiKeys.length > 0 ? (
                apiKeys.map((apiKey) => (
                  <tr
                    key={apiKey.id}
                    className="dark:bg-neutral-800 dark:hover:bg-neutral-700"
                  >
                    <td className="size-px whitespace-nowrap">
                      <div className="px-6 py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-300">
                          {apiKey.name}
                        </span>
                      </div>
                    </td>
                    <td className="size-px whitespace-nowrap">
                      <div className="px-6 py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-300">
                          {apiKey.description}
                        </span>
                      </div>
                    </td>
                    <td className="size-px whitespace-nowrap">
                      <div className="px-6 py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-300">
                          {apiKey.key}
                        </span>
                      </div>
                    </td>
                    <td className="size-px whitespace-nowrap">
                      <div className="px-6 py-3 flex items-center gap-x-2">
                        <span className="text-sm">
                          <span
                            className={`${
                              isPast(new Date(apiKey.expirationDate))
                                ? "text-red-600 dark:text-red-400"
                                : "text-gray-500 dark:text-gray-300"
                            }`}
                          >
                            {
                              isExpiringIn(new Date(apiKey.expirationDate))
                                .message
                            }
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="size-px whitespace-nowrap">
                      <div className="px-6 py-3">
                        <span className="text-sm text-gray-500 dark:text-gray-300">
                          {new Date(apiKey.createdDate).toDateString()}
                        </span>
                      </div>
                    </td>
                    <td className="size-px whitespace-nowrap">
                      <div className="px-6 py-1.5">
                        <Button
                          variant="white"
                          onClick={() => onManageAPIKey(apiKey.id)}
                        >
                          {t('components.apiKeyTable.manage')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center">
                    <NotFoundElement
                      title={t('components.apiKeyTable.noResultsFound')}
                      description={t('components.apiKeyTable.noApiKeys')}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 grid gap-3 md:flex md:justify-between md:items-center border-t border-gray-200 dark:border-neutral-700">
          <div>
            <p className="text-sm text-gray-500 dark:text-neutral-400">
              <span className="font-semibold text-black dark:text-gray-300">
                {totalKeys}
              </span>{" "}
              {t('components.apiKeyTable.totalKeys')}
            </p>
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalKeys}
            pageSize={pageSize}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        </div>
      </div>

      {showAddModal && (
        <CreateAPIKeyModal
          onCreate={handleCreateAPIKey}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
};

export default APIKeyTable;
