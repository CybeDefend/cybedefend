import { useCallback, useEffect, useRef } from 'react';

/**
 * Coalesce rapid invocations into a single trailing call.
 * The fn closure is always read fresh at fire time, so callers don't have to memoize it.
 */
export function useDebouncedCallback(fn: () => void, delayMs: number): () => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (mounted.current) fnRef.current();
    }, delayMs);
  }, [delayMs]);
}

export default useDebouncedCallback;
