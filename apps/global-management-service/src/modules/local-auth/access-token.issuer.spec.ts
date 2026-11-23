import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify as cryptoVerify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import { ACCESS_TOKEN_TTL_S, AccessTokenIssuer } from './access-token.issuer';
import type { SigningKeyService } from './signing-key.service';

/**
 * The Community Edition's access token: an ES256 JWT, header
 * { alg, typ, kid }, claims iss=cybedefend-community, aud=cybedefend-api, sub
 * and cybeid = the user UUID, email, name, iat and exp = iat + 900 (seconds,
 * RFC 7519). The signature is IEEE P1363, as JWS requires for ES256. Only the
 * value returned for the proto is in epoch milliseconds.
 */
describe('AccessTokenIssuer', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const kid = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest()
    .subarray(0, 16)
    .toString('base64url');

  const signingKeys = {
    currentKey: async (): Promise<{ kid: string; privateKey: KeyObject }> => ({
      kid,
      privateKey,
    }),
  } as unknown as SigningKeyService;

  const issuer = new AccessTokenIssuer(signingKeys);
  const user = {
    id: '7f0d3e52-1c4a-4c6e-9a2b-0c1d2e3f4a5b',
    email: 'ada@example.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
  };
  const now = new Date('2026-11-03T12:00:00.000Z');

  function decode(token: string): {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    signingInput: string;
    signature: Buffer;
  } {
    const [h, p, s] = token.split('.');
    return {
      header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')),
      signingInput: `${h}.${p}`,
      signature: Buffer.from(s, 'base64url'),
    };
  }

  it('signs ES256 with iss, aud, sub, cybeid, email, name, iat, exp', async () => {
    const { token } = await issuer.issue(user, now);
    const { header, payload } = decode(token);
    expect(header).toEqual({ alg: 'ES256', typ: 'JWT', kid });
    expect(payload.iss).toBe('cybedefend-community');
    expect(payload.aud).toBe('cybedefend-api');
    expect(payload.sub).toBe(user.id);
    expect(payload.cybeid).toBe(user.id);
    expect(payload.email).toBe(user.email);
    expect(payload.name).toBe('Ada Lovelace');
    expect(payload.iat).toBe(Math.floor(now.getTime() / 1000));
    expect(Number(payload.exp) - Number(payload.iat)).toBe(ACCESS_TOKEN_TTL_S);
    expect(ACCESS_TOKEN_TTL_S).toBe(900);
  });

  it('returns the expiry in epoch milliseconds', async () => {
    const { token, expiresAt } = await issuer.issue(user, now);
    const { payload } = decode(token);
    expect(expiresAt).toBe(Number(payload.exp) * 1000);
  });

  it('gives back a one-string name unchanged', async () => {
    // Local auth stores a person's name as firstName = name.trim(), lastName = ''
    const { token } = await issuer.issue(
      { ...user, firstName: 'Ada Lovelace', lastName: '' },
      now,
    );
    expect(decode(token).payload.name).toBe('Ada Lovelace');
  });

  it('verifies with the published JWK', async () => {
    const { token } = await issuer.issue(user, now);
    const { signingInput, signature } = decode(token);
    const jwk = {
      ...(publicKey.export({ format: 'jwk' }) as JsonWebKey),
      kid,
      alg: 'ES256',
      use: 'sig',
    };
    const verified = cryptoVerify(
      'sha256',
      Buffer.from(signingInput, 'utf8'),
      {
        key: createPublicKey({ key: jwk, format: 'jwk' }),
        dsaEncoding: 'ieee-p1363',
      },
      signature,
    );
    expect(verified).toBe(true);
  });
});
