import { useState, useEffect, useCallback } from "react";
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Cache system for hooks to prevent unnecessary API calls
 * Provides TTL-based caching with organization-scoped storage
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  key?: string; // Optional custom cache key
}

class HookCache {
  private cache = new Map<string, CacheEntry<any>>();
  private readonly defaultTTL = 5 * 60 * 1000; // 5 minutes default TTL

  /**
   * Generate cache key with organization and project scope
   */
  private generateKey(organizationId: string, scope: string, projectId?: string): string {
    return projectId 
      ? `${organizationId}:${scope}:${projectId}`
      : `${organizationId}:${scope}`;
  }

  /**
   * Check if cache entry is valid (not expired)
   */
  private isValid<T>(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp < entry.ttl;
  }

  /**
   * Get cached data if valid, otherwise return null
   */
  get<T>(
    organizationId: string, 
    scope: string, 
    projectId?: string,
    options?: CacheOptions
  ): T | null {
    const key = options?.key || this.generateKey(organizationId, scope, projectId);
    const entry = this.cache.get(key);
    
    if (entry && this.isValid(entry)) {
      return entry.data;
    }
    
    // Remove expired entry
    if (entry) {
      this.cache.delete(key);
    }
    
    return null;
  }

  /**
   * Set cache data with TTL
   */
  set<T>(
    organizationId: string,
    scope: string,
    data: T,
    projectId?: string,
    options?: CacheOptions
  ): void {
    const key = options?.key || this.generateKey(organizationId, scope, projectId);
    const ttl = options?.ttl || this.defaultTTL;
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Invalidate cache entries by pattern
   */
  invalidate(organizationId: string, scope?: string, projectId?: string): void {
    const pattern = scope 
      ? (projectId ? `${organizationId}:${scope}:${projectId}` : `${organizationId}:${scope}`)
      : `${organizationId}:`;
    
    const keysToDelete: string[] = [];
    this.cache.forEach((_, key) => {
      if (key.startsWith(pattern)) {
        keysToDelete.push(key);
      }
    });
    
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): { size: number; keys: string[] } {
    const keys: string[] = [];
    this.cache.forEach((_, key) => keys.push(key));
    
    return {
      size: this.cache.size,
      keys,
    };
  }
}

// Singleton instance for the entire application
export const hookCache = new HookCache();

/**
 * Cached fetch function wrapper for hooks
 * Automatically handles caching and prevents duplicate API calls
 */
export const useCachedFetch = <T>(
  organizationId: string,
  scope: string,
  fetchFunction: () => Promise<T>,
  projectId?: string,
  options?: CacheOptions
): {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} => {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const fetch = useCallback(async () => {
    if (!organizationId) return;

    // Check cache first
    const cachedData = hookCache.get<T>(organizationId, scope, projectId, options);
    if (cachedData && isInitialized) {
      setData(cachedData);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchFunction();
      setData(result);
      
      // Cache the result
      hookCache.set(organizationId, scope, result, projectId, options);
    } catch (err: any) {
      setError(apiErrorText(err));
      setData(null);
    } finally {
      setIsLoading(false);
      setIsInitialized(true);
    }
  }, [organizationId, scope, projectId, fetchFunction, isInitialized, options]);

  // Initial fetch on mount
  useEffect(() => {
    if (organizationId && !isInitialized) {
      fetch();
    }
  }, [fetch, organizationId, isInitialized]);

  return {
    data,
    isLoading,
    error,
    refetch: fetch,
  };
};
