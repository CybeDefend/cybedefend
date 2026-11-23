import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  PersonalAccessTokenView,
  PersonalAccessTokenUsage,
} from '../interfaces/PersonalAccessToken';
import { fetchTokenList } from '../services/patService';
import { apiErrorText } from '@/utils/function/apiErrorKey';

/**
 * Hook to manage the list of personal access tokens (both editions; see patService).
 *
 * SECURITY: the returned tokens never carry the raw `value` — the
 * backend strips it. Only `usage` is consumed by the dashboard to drive
 * the X/10 cap indicator and the disabled-create-button state.
 *
 * `failed` says the last read failed; `error` is the cloud's own message,
 * which the Community page never shows (it prints a fixed sentence).
 */
const usePersonalAccessTokens = (enabled = true) => {
  const [tokens, setTokens] = useState<PersonalAccessTokenView[]>([]);
  const [usage, setUsage] = useState<PersonalAccessTokenUsage | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const fetchedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFailed(false);
    try {
      // The service normalises the dates (proto int64 arrives as a string over JSON).
      const data = await fetchTokenList();
      const normalised = data.tokens;
      setTokens(normalised);
      // Backend returns usage so the create button can be gated; if missing
      // (e.g. older backend) we synthesise current from the array length and
      // fall back to the documented cap.
      setUsage(
        data.usage ?? {
          current: normalised.length,
          max: 10,
        },
      );
    } catch (err: any) {
      setTokens([]);
      setUsage(undefined);
      setFailed(true);
      setError(
        apiErrorText(err),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    // Prevent double-fetch in StrictMode
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    load();
  }, [load, enabled]);

  const refresh = useCallback(() => {
    // Allow manual refresh
    load();
  }, [load]);

  return { tokens, usage, loading, error, failed, refresh };
};

export default usePersonalAccessTokens;
