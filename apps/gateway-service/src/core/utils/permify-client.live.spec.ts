/**
 * The factory against a real Permify that enforces preshared-key
 * authentication. Opt-in, against a throwaway container:
 *
 *   docker run -d --rm --name permify-authn -p 13478:3478 \
 *     -e PERMIFY_AUTHN_ENABLED=true -e PERMIFY_AUTHN_METHOD=preshared \
 *     -e PERMIFY_AUTHN_PRESHARED_KEYS=live-test-key \
 *     ghcr.io/permify/permify:v1.6.10 serve
 *   PERMIFY_AUTHN_LIVE=1 PERMIFY_AUTHN_ENDPOINT=localhost:13478 \
 *     PERMIFY_AUTHN_KEY=live-test-key \
 *     pnpm exec jest src/core/utils/permify-client.live.spec.ts
 */
import { createPermifyClient } from './permify-client';

const live = process.env.PERMIFY_AUTHN_LIVE === '1';
const endpoint = process.env.PERMIFY_AUTHN_ENDPOINT ?? 'localhost:13478';
const key = process.env.PERMIFY_AUTHN_KEY ?? 'live-test-key';

const writeSchema = (readKey: () => string | undefined) =>
  createPermifyClient(endpoint, readKey).schema.write({
    tenantId: 't1',
    schema: 'entity user {}',
  });

(live ? describe : describe.skip)(
  'Permify with preshared-key authentication',
  () => {
    jest.setTimeout(20_000);

    it('refuses a call that carries no key', async () => {
      await expect(writeSchema(() => undefined)).rejects.toThrow(
        /MISSING_BEARER_TOKEN/,
      );
    });

    it('refuses a call that carries another key', async () => {
      await expect(writeSchema(() => `${key}-wrong`)).rejects.toThrow(
        /UNAUTHENTICATED|INVALID_BEARER_TOKEN/i,
      );
    });

    it('accepts a call that carries the key', async () => {
      const answer = await writeSchema(() => key);
      expect(answer.schemaVersion).toEqual(expect.any(String));
      expect(answer.schemaVersion).not.toBe('');
    });
  },
);
