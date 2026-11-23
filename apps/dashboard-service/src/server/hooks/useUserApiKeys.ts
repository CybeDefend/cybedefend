

import { useState, useEffect } from "react";
import useDebouncedValue from "./useDebouncedValue";
import { fetchUserApiKeys } from "../services/apikeyService";
import { APIKey } from "../interfaces/ApiKey";
import { apiErrorText } from '@/utils/function/apiErrorKey';

const useUserApiKeys = (
  userId: string,
  pageSize: number,
  searchQuery: string
) => {
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
  const [totalKeys, setTotalKeys] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshFlag, setRefreshFlag] = useState<boolean>(false);

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);

  const fetchKeys = async (page: number, query: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUserApiKeys(page, pageSize, query);
      setApiKeys(data.apikeys);
      setTotalKeys(data.totalApikeys);
      setTotalPages(data.totalPages);
    } catch (err: any) {
      setApiKeys([]);
      setTotalKeys(0);
      setTotalPages(0);
      setError(
        apiErrorText(err)
      );
    } finally {
      setLoading(false);
    }
  };

  
  useEffect(() => {
    if (!userId) {
      setApiKeys([]);
      setTotalKeys(0);
      setTotalPages(0);
      return;
    }
    fetchKeys(currentPage, debouncedSearchQuery);
  }, [userId, currentPage, debouncedSearchQuery, pageSize, refreshFlag]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
  };

  const refresh = () => {
    setRefreshFlag((prev) => !prev);
  };

  return {
    apiKeys,
    totalKeys,
    totalPages,
    currentPage,
    loading,
    error,
    goToPage,
    refresh
  };
};

export default useUserApiKeys;
