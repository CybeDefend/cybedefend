import { fetchEventSource } from '@microsoft/fetch-event-source';

export interface SseEvent {
    event: string;
    data: string;
}

export interface OpenSseStreamOptions {
    headers?: Record<string, string>;
    signal?: AbortSignal;
}

/**
 * Authenticated SSE client built on @microsoft/fetch-event-source.
 *
 * Why not native EventSource: the W3C EventSource API cannot set custom
 * request headers, which forces us to smuggle the Logto JWT in the URL
 * query — a leak vector for proxy access logs. The fetch-event-source
 * polyfill goes through `fetch`, so we can attach
 * `Authorization: Bearer …` securely. The Logto user JWT is the only
 * credential carried on chat streaming requests now (the legacy
 * `X-MCP-Token` header was removed).
 *
 * Behavior:
 * - User-initiated aborts (`options.signal.abort()` or AbortError) are
 *   treated as clean cancellations: `onComplete` runs, `onError` does not.
 * - Non-2xx HTTP responses surface through `onError` once and the polyfill
 *   stops retrying.
 * - Network failures do the same — single onError call, no retry storm.
 *
 * The dashboard's `globalChatService.streamMessage` uses this helper to
 * consume the organization-scoped chat stream.
 */
export async function openSseStream(
    url: string,
    options: OpenSseStreamOptions,
    onEvent: (event: SseEvent) => void,
    onError: (err: Error) => void,
    onComplete: () => void,
): Promise<void> {
    const userSignal = options.signal;
    let userAborted = userSignal?.aborted === true;
    if (userSignal && !userAborted) {
        userSignal.addEventListener(
            'abort',
            () => {
                userAborted = true;
            },
            { once: true },
        );
    }

    try {
        await fetchEventSource(url, {
            method: 'GET',
            headers: {
                Accept: 'text/event-stream',
                ...(options.headers ?? {}),
            },
            signal: userSignal,
            // Keep the stream alive when the tab is in the background — the
            // assistant may still be producing tokens; default behavior pauses
            // the EventSource which would silently drop data.
            openWhenHidden: true,
            async onopen(response: Response): Promise<void> {
                if (!response.ok) {
                    throw new Error(`SSE failed: HTTP ${response.status}`);
                }
            },
            onmessage(ev: { event: string; data: string }): void {
                if (!ev.event) return;
                onEvent({ event: ev.event, data: ev.data });
            },
            onerror(err: unknown): never {
                // Throwing stops the polyfill's automatic retry loop. The
                // outer try/catch turns the rethrown error into either a
                // clean cancellation (AbortError) or an `onError(e)` call.
                throw err instanceof Error ? err : new Error(String(err));
            },
        });
        onComplete();
    } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (userAborted || e.name === 'AbortError') {
            onComplete();
            return;
        }
        onError(e);
    }
}
