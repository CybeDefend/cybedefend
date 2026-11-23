import { describe, it, expect, vi, beforeEach } from 'vitest';

import { openSseStream, type SseEvent } from './sseClient';

const fetchEventSourceMock = vi.fn();

vi.mock('@microsoft/fetch-event-source', () => ({
    fetchEventSource: (...args: unknown[]) => fetchEventSourceMock(...args),
}));

interface CapturedHandlers {
    onopen?: (response: Response) => Promise<void>;
    onmessage?: (ev: { event: string; data: string }) => void;
    onerror?: (err: unknown) => number | void;
    onclose?: () => void;
}

const wireMock = (): {
    resolve: () => void;
    capture: CapturedHandlers;
} => {
    let outerResolve: () => void = () => {};
    let outerReject: (err: Error) => void = () => {};
    const promise = new Promise<void>((res, rej) => {
        outerResolve = res;
        outerReject = rej;
    });
    const capture: CapturedHandlers = {};
    fetchEventSourceMock.mockImplementation(
        (_url: string, init: CapturedHandlers) => {
            capture.onopen = async (response: Response) => {
                try {
                    await init.onopen?.(response);
                } catch (e) {
                    outerReject(e as Error);
                    throw e;
                }
            };
            capture.onmessage = init.onmessage;
            capture.onerror = (err: unknown) => {
                try {
                    return init.onerror?.(err);
                } catch (e) {
                    outerReject(e as Error);
                    throw e;
                }
            };
            capture.onclose = init.onclose;
            return promise;
        },
    );
    return { resolve: () => outerResolve(), capture };
};

describe('openSseStream', () => {
    beforeEach(() => {
        fetchEventSourceMock.mockReset();
    });

    it('forwards each SSE message to onEvent with the parsed event/data', async () => {
        const { resolve, capture } = wireMock();
        const onEvent = vi.fn<(event: SseEvent) => void>();
        const onError = vi.fn();
        const onComplete = vi.fn();

        const promise = openSseStream(
            '/organizations/org-1/chat/conversations/c1/stream?streamId=s1',
            {},
            onEvent,
            onError,
            onComplete,
        );
        // Allow the mock to register its handlers.
        await Promise.resolve();

        capture.onmessage?.({ event: 'token', data: '{"delta":"He"}' });
        capture.onmessage?.({ event: 'final', data: '{"end":true}' });
        capture.onclose?.();
        resolve();
        await promise;

        expect(onEvent).toHaveBeenNthCalledWith(1, {
            event: 'token',
            data: '{"delta":"He"}',
        });
        expect(onEvent).toHaveBeenNthCalledWith(2, {
            event: 'final',
            data: '{"end":true}',
        });
        expect(onError).not.toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('passes Authorization, signal and openWhenHidden to fetchEventSource', async () => {
        wireMock();
        const controller = new AbortController();
        const onEvent = vi.fn();
        const onError = vi.fn();
        const onComplete = vi.fn();

        // Don't await — we just want to inspect the call. The mock keeps
        // the outer promise pending forever.
        void openSseStream(
            '/stream',
            {
                headers: {
                    Authorization: 'Bearer logto-token',
                },
                signal: controller.signal,
            },
            onEvent,
            onError,
            onComplete,
        );
        await Promise.resolve();

        expect(fetchEventSourceMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchEventSourceMock.mock.calls[0] as [
            string,
            Record<string, unknown>,
        ];
        expect(url).toBe('/stream');
        expect(init).toMatchObject({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: 'Bearer logto-token',
                Accept: 'text/event-stream',
            }),
            openWhenHidden: true,
            signal: controller.signal,
        });
        // X-MCP-Token was retired alongside the dedicated MCP-scoped JWT.
        expect(
            (init.headers as Record<string, string>)['X-MCP-Token'],
        ).toBeUndefined();
    });

    it('treats AbortError from the user-supplied signal as a clean cancellation', async () => {
        const { capture } = wireMock();
        const onEvent = vi.fn();
        const onError = vi.fn();
        const onComplete = vi.fn();
        const controller = new AbortController();

        const promise = openSseStream(
            '/stream',
            { signal: controller.signal },
            onEvent,
            onError,
            onComplete,
        );
        await Promise.resolve();

        controller.abort();
        const abortError = new DOMException('aborted', 'AbortError');
        // Calling onerror with AbortError should bubble up and stop retries.
        try {
            capture.onerror?.(abortError);
        } catch {
            /* expected */
        }

        await promise;

        expect(onError).not.toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('escalates non-2xx responses via onError and stops retrying', async () => {
        const { capture } = wireMock();
        const onEvent = vi.fn();
        const onError = vi.fn();
        const onComplete = vi.fn();

        const promise = openSseStream(
            '/stream',
            {},
            onEvent,
            onError,
            onComplete,
        );
        await Promise.resolve();

        const badResponse = new Response('forbidden', { status: 403 });
        await expect(capture.onopen?.(badResponse)).rejects.toThrow();
        await promise;

        expect(onError).toHaveBeenCalledTimes(1);
        const errArg = onError.mock.calls[0][0] as Error;
        expect(errArg.message).toMatch(/403/);
    });

    it('surfaces non-abort fatal errors via onError', async () => {
        const { capture } = wireMock();
        const onEvent = vi.fn();
        const onError = vi.fn();
        const onComplete = vi.fn();

        const promise = openSseStream(
            '/stream',
            {},
            onEvent,
            onError,
            onComplete,
        );
        await Promise.resolve();

        try {
            capture.onerror?.(new Error('network down'));
        } catch {
            /* expected */
        }
        await promise;

        expect(onError).toHaveBeenCalledTimes(1);
        expect((onError.mock.calls[0][0] as Error).message).toBe('network down');
    });
});
