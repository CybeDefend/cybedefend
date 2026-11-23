import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '@/utils/copyText';

/** How long `copied` stays true after a copy, by default. */
export const DEFAULT_COPIED_RESET_MS = 2000;

export interface UseCopyToClipboardOptions {
  /** How long `copied` stays true after a successful copy. */
  resetAfterMs?: number;
}

export interface UseCopyToClipboardResult {
  copied: boolean;
  /** Writes `text` to the clipboard; resolves false when the browser refuses. */
  copy: (text: string) => Promise<boolean>;
}

/**
 * Copies text to the clipboard and exposes a short-lived `copied` mark.
 *
 * One timer at a time: a new copy restarts the countdown, and unmounting
 * clears it. A copy that resolves after unmount touches no state.
 */
export function useCopyToClipboard(options: UseCopyToClipboardOptions = {}): UseCopyToClipboardResult {
  const { resetAfterMs = DEFAULT_COPIED_RESET_MS } = options;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (!(await copyText(text))) return false;
      if (!mounted.current) return true;
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        setCopied(false);
      }, resetAfterMs);
      return true;
    },
    [resetAfterMs],
  );

  return { copied, copy };
}

export default useCopyToClipboard;
