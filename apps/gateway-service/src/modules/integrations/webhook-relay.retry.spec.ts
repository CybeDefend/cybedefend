/**
 * The GitHub and GitLab webhook relays retry ONCE, after a
 * short wait, when external-integrations answers UNAVAILABLE.
 *
 * GitHub does not redeliver a failed webhook on its own, so every 503 the
 * gateway returned during a deployment ("no healthy upstream", "connection
 * refused") was a push, branch or installation event lost for good. Only
 * UNAVAILABLE is retried: any other status is an answer from
 * external-integrations, and the provider waits for ours (10 s for GitHub).
 */
import { HttpException } from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Observable, of, throwError } from 'rxjs';
import { GithubService } from './github/github.service';
import { GitlabService } from './gitlab/gitlab.service';
import { WEBHOOK_RELAY_RETRY_DELAY_MS } from './webhook-relay';

type HandleWebhook = jest.Mock<Observable<{ success: boolean }>, unknown[]>;

const grpcError = (code: number, details: string) =>
  throwError(() => Object.assign(new Error(details), { code, details }));

/** A signature shaped like GitHub's (its HMAC is checked in EI). */
const WELL_FORMED_SIGNATURE = `sha256=${'ab'.repeat(32)}`;

/** The two relays, built the way Nest builds them. */
function relays(
  handleWebhook: HandleWebhook,
  credentials: { signature?: string; gitlabToken?: string } = {},
) {
  const client = { getService: jest.fn(() => ({ handleWebhook })) };

  const github = new GithubService(client as never);
  github.onModuleInit();
  const gitlab = new GitlabService(
    client as never,
    { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
  );
  gitlab.onModuleInit();

  return [
    [
      'GitHub',
      () =>
        github.handleWebhookEvent({
          bodyJson: '{}',
          event: 'push',
          action: '',
          signature: credentials.signature ?? WELL_FORMED_SIGNATURE,
        }),
    ],
    [
      'GitLab',
      () =>
        gitlab.handleWebhookEvent({
          bodyJson: '{}',
          event: 'Push Hook',
          gitlabToken: credentials.gitlabToken ?? 't',
        }),
    ],
  ] as const;
}

describe('webhook relays retry once on UNAVAILABLE', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  for (const provider of ['GitHub', 'GitLab'] as const) {
    describe(provider, () => {
      const relayOf = (handleWebhook: HandleWebhook) =>
        relays(handleWebhook).find(([name]) => name === provider)![1];

      it('answers the second attempt after one UNAVAILABLE', async () => {
        const handleWebhook: HandleWebhook = jest
          .fn()
          .mockReturnValueOnce(
            grpcError(GrpcStatus.UNAVAILABLE, 'no healthy upstream'),
          )
          .mockReturnValueOnce(of({ success: true }));

        const pending = relayOf(handleWebhook)();
        await jest.advanceTimersByTimeAsync(0);
        // The retry waits: nothing is sent again before the delay.
        expect(handleWebhook).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(WEBHOOK_RELAY_RETRY_DELAY_MS);

        await expect(pending).resolves.toEqual({ success: true });
        expect(handleWebhook).toHaveBeenCalledTimes(2);
        // The same event is relayed again.
        expect(handleWebhook.mock.calls[1][0]).toEqual(
          handleWebhook.mock.calls[0][0],
        );
      });

      it('answers 503 after a second UNAVAILABLE, and stops there', async () => {
        const handleWebhook: HandleWebhook = jest.fn(() =>
          grpcError(GrpcStatus.UNAVAILABLE, 'Connection refused'),
        );

        const pending = relayOf(handleWebhook)();
        const outcome = expect(pending).rejects.toMatchObject({
          status: 503,
        });
        await jest.advanceTimersByTimeAsync(WEBHOOK_RELAY_RETRY_DELAY_MS * 5);

        await outcome;
        expect(handleWebhook).toHaveBeenCalledTimes(2);
      });

      it.each([
        [GrpcStatus.ALREADY_EXISTS, 409],
        [GrpcStatus.UNAUTHENTICATED, 401],
        [GrpcStatus.INVALID_ARGUMENT, 400],
        [GrpcStatus.DEADLINE_EXCEEDED, 504],
        [GrpcStatus.INTERNAL, 500],
      ])(
        'never retries any other status (gRPC %i → HTTP %i)',
        async (code, httpStatus) => {
          const handleWebhook: HandleWebhook = jest.fn(() =>
            grpcError(code, 'answered'),
          );

          const pending = relayOf(handleWebhook)();
          const outcome = expect(pending).rejects.toBeInstanceOf(HttpException);
          await jest.advanceTimersByTimeAsync(WEBHOOK_RELAY_RETRY_DELAY_MS * 5);

          await outcome;
          await expect(pending).rejects.toMatchObject({ status: httpStatus });
          expect(handleWebhook).toHaveBeenCalledTimes(1);
        },
      );

      it('sends once when the first attempt succeeds', async () => {
        const handleWebhook: HandleWebhook = jest.fn(() =>
          of({ success: true }),
        );

        await expect(relayOf(handleWebhook)()).resolves.toEqual({
          success: true,
        });
        expect(handleWebhook).toHaveBeenCalledTimes(1);
      });
    });
  }

  // A request that cannot be a provider's is not worth a
  // second call and a second of open connection. Its signature is still
  // checked (and refused) by external-integrations on the first call.
  describe('a request that cannot be the provider’s is not retried', () => {
    it.each([
      ['no signature', ''],
      ['a malformed signature', 'sha256=fake'],
      ['a SHA-1 signature', `sha1=${'ab'.repeat(20)}`],
      ['an upper-case digest', `sha256=${'AB'.repeat(32)}`],
    ])('GitHub, %s', async (_label, signature) => {
      const handleWebhook: HandleWebhook = jest.fn(() =>
        grpcError(GrpcStatus.UNAVAILABLE, 'no healthy upstream'),
      );
      const [[, relay]] = relays(handleWebhook, { signature });

      const pending = relay();
      const outcome = expect(pending).rejects.toMatchObject({ status: 503 });
      await jest.advanceTimersByTimeAsync(WEBHOOK_RELAY_RETRY_DELAY_MS * 5);

      await outcome;
      expect(handleWebhook).toHaveBeenCalledTimes(1);
    });

    it('GitLab, no token', async () => {
      const handleWebhook: HandleWebhook = jest.fn(() =>
        grpcError(GrpcStatus.UNAVAILABLE, 'no healthy upstream'),
      );
      const [, [, relay]] = relays(handleWebhook, { gitlabToken: '' });

      const pending = relay();
      const outcome = expect(pending).rejects.toMatchObject({ status: 503 });
      await jest.advanceTimersByTimeAsync(WEBHOOK_RELAY_RETRY_DELAY_MS * 5);

      await outcome;
      expect(handleWebhook).toHaveBeenCalledTimes(1);
    });
  });

  it('waits a short, fixed time, well within the providers’ 10 s delivery timeout', () => {
    expect(WEBHOOK_RELAY_RETRY_DELAY_MS).toBeGreaterThanOrEqual(250);
    expect(WEBHOOK_RELAY_RETRY_DELAY_MS).toBeLessThanOrEqual(2_000);
  });
});
