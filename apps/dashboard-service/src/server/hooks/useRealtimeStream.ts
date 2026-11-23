import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { openStream, Handlers } from '@/server/services/realtimeStream';
import { getAccessTokenForFetch } from '@/server/api/tokenManager';

interface RootStateAuth { auth: { accessToken: string | null } }

export function useRealtimeStream(url: string | null, handlers: Handlers, deps: unknown[] = []): void {
  const accessToken = useSelector((s: RootStateAuth) => s.auth.accessToken);
  const accessTokenRef = useRef<string | null>(accessToken);
  accessTokenRef.current = accessToken;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // We deliberately depend on the boolean presence of a token, not its value.
  // The gateway sends an `auth-refresh` SSE event ~60s before token expiry,
  // and openStream's handler reconnects via tokenProvider — which now reads
  // the latest value from `accessTokenRef`. Re-running the effect on every
  // rotation in addition would tear down + reopen the same connection,
  // producing a second request for every renewal.
  const hasToken = Boolean(accessToken);

  useEffect(() => {
    if (!url || !hasToken) return;
    const handle = openStream(
      url,
      new Proxy({} as Handlers, {
        get: (_t, p: string) => (env: any) => {
          const h = (handlersRef.current as any)[p];
          if (h) h(env);
        },
      }),
      {
        tokenProvider: () => accessTokenRef.current,
        // Reconnects must not replay the redux snapshot. The gateway ends a
        // stream at the exact expiry of the token it was opened with, and at
        // that instant the snapshot IS that expired token: @logto/client only
        // rotates once the cached token is fully expired, so the `auth-refresh`
        // warning 60s earlier cannot produce a newer one. Going back to the SDK
        // here returns the cached token while it is still valid and mints a new
        // one from the refresh token when it is not.
        refreshToken: () => getAccessTokenForFetch(),
      },
    );
    return () => handle.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, hasToken, ...deps]);
}

export default useRealtimeStream;
