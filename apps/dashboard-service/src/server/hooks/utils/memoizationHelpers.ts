/**
 * Memoization helpers for React hooks
 * Provides stable references and optimized dependencies management
 */

import { useCallback, useMemo, useRef, useState, useEffect } from "react";

/**
 * Creates a stable callback that doesn't change unless dependencies change
 * More strict than useCallback with better dependency tracking
 */
export const useStableCallback = <T extends (...args: any[]) => any>(
  callback: T,
  deps: React.DependencyList
): T => {
  const callbackRef = useRef<T>(callback);
  const depsRef = useRef<React.DependencyList>(deps);

  // Update callback only if dependencies actually changed
  const hasChanged = useMemo(() => {
    if (depsRef.current.length !== deps.length) return true;
    return depsRef.current.some((dep, index) => dep !== deps[index]);
  }, deps);

  if (hasChanged) {
    callbackRef.current = callback;
    depsRef.current = deps;
  }

  return useCallback(callbackRef.current, deps);
};

/**
 * Creates a stable object that doesn't change unless its properties change
 * Useful for hook options and configuration objects
 */
export const useStableObject = <T extends Record<string, any>>(obj: T): T => {
  return useMemo(() => obj, [
    ...Object.keys(obj).sort((a, b) => a.localeCompare(b)).map(key => obj[key])
  ]);
};

/**
 * Creates a stable array that doesn't change unless its elements change
 * Performs deep comparison of array elements
 */
export const useStableArray = <T>(array: T[]): T[] => {
  return useMemo(() => array, [
    array.length,
    ...array.map(item => 
      typeof item === 'object' && item !== null 
        ? JSON.stringify(item) 
        : item
    )
  ]);
};

/**
 * Debounced state that updates only after a delay
 * Returns both immediate and debounced values
 */
export const useDebouncedState = <T>(
  initialValue: T,
  delay: number = 300
): [T, T, (value: T) => void] => {
  const [immediateValue, setImmediateValue] = useState<T>(initialValue);
  const [debouncedValue, setDebouncedValue] = useState<T>(initialValue);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const setValue = useCallback((newValue: T) => {
    setImmediateValue(newValue);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      setDebouncedValue(newValue);
    }, delay);
  }, [delay]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [immediateValue, debouncedValue, setValue];
};

/**
 * Prevents unnecessary re-renders by memoizing component props
 */
export const useMemoizedProps = <T extends Record<string, any>>(props: T): T => {
  return useMemo(() => {
    const memoizedProps = {} as T;
    Object.keys(props).forEach(key => {
      memoizedProps[key as keyof T] = props[key];
    });
    return memoizedProps;
  }, [JSON.stringify(props)]);
};

/**
 * Creates a stable function reference that persists across re-renders
 * Useful for event handlers and API functions
 */
export const useEventCallback = <T extends (...args: any[]) => any>(fn: T): T => {
  const ref = useRef<T>(fn);
  
  // Update the ref during render so we capture any changes
  ref.current = fn;
  
  // Return a stable callback that calls the latest function
  return useCallback((...args: any[]) => {
    return ref.current(...args);
  }, []) as T;
};

/**
 * Optimized useEffect that only runs when dependencies actually change
 * Performs deep comparison of dependencies
 */
export const useDeepEffect = (
  effect: React.EffectCallback,
  deps: React.DependencyList
) => {
  const prevDepsRef = useRef<React.DependencyList>(deps);
  
  const hasChanged = useMemo(() => {
    if (prevDepsRef.current.length !== deps.length) return true;
    
    return prevDepsRef.current.some((dep, index) => {
      const currentDep = deps[index];
      
      // Deep comparison for objects and arrays
      if (typeof dep === 'object' && typeof currentDep === 'object') {
        return JSON.stringify(dep) !== JSON.stringify(currentDep);
      }
      
      return dep !== currentDep;
    });
  }, deps);

  useEffect(() => {
    if (hasChanged) {
      prevDepsRef.current = deps;
      return effect();
    }
  }, [hasChanged]);
};
