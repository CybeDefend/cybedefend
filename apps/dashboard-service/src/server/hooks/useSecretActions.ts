import { useState, useCallback } from 'react';
import gatewayAPI from '../api/gatewayAPI';
import { apiErrorKey } from '@/utils/function/apiErrorKey';

// ---------------------------------------------------------------------------
// useRevealSecret
// ---------------------------------------------------------------------------

interface RevealSecretData {
  secret: string;
  revealedAt: string;
}

interface RevealSecretError {
  status: number;
  /** The translation key of the refusal, never the server's text. */
  key: string;
}

interface UseRevealSecretReturn {
  data: RevealSecretData | null;
  loading: boolean;
  error: RevealSecretError | null;
  reveal: () => void;
  hide: () => void;
}

export function useRevealSecret(
  projectId: string,
  vulnerabilityId: string,
): UseRevealSecretReturn {
  const [data, setData] = useState<RevealSecretData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RevealSecretError | null>(null);

  const reveal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await gatewayAPI.post(
        `/project/${projectId}/results/secret/${vulnerabilityId}/reveal`,
      );
      const responseData = response.data?.data ?? response.data;
      setData({
        secret: responseData.secret,
        revealedAt: responseData.revealedAt,
      });
    } catch (err: any) {
      const status = err.response?.status ?? 500;
      setError({ status, key: apiErrorKey(err) });
    } finally {
      setLoading(false);
    }
  }, [projectId, vulnerabilityId]);

  const hide = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { data, loading, error, reveal, hide };
}

// ---------------------------------------------------------------------------
// useRotateSecret
// ---------------------------------------------------------------------------

interface UseRotateSecretReturn {
  rotate: () => Promise<boolean>;
  loading: boolean;
  error: RevealSecretError | null;
}

export function useRotateSecret(
  projectId: string,
  vulnerabilityId: string,
): UseRotateSecretReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RevealSecretError | null>(null);

  const rotate = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      await gatewayAPI.post(
        `/project/${projectId}/results/secret/${vulnerabilityId}/rotate`,
      );
      return true;
    } catch (err: any) {
      const status = err.response?.status ?? 500;
      setError({ status, key: apiErrorKey(err) });
      return false;
    } finally {
      setLoading(false);
    }
  }, [projectId, vulnerabilityId]);

  return { rotate, loading, error };
}
