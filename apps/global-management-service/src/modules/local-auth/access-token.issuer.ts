import { sign as cryptoSign } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SigningKeyService } from './signing-key.service';

/**
 * The Community Edition's access token: an ES256 JWT (RFC 7519), 15
 * minutes. Header { alg: 'ES256', typ: 'JWT', kid }, claims
 * iss=cybedefend-community, aud=cybedefend-api, sub and cybeid = the internal
 * user UUID, email, name, iat and exp = iat + 900 in seconds. The signature is
 * IEEE P1363 (raw r||s), as JWS requires for ES256, over the base64url
 * signing input.
 *
 * Only the value returned for the proto's LocalAuthSession is in epoch
 * milliseconds; the JWT itself keeps seconds.
 */
export const ACCESS_TOKEN_TTL_S = 900;

const ISSUER = 'cybedefend-community';
const AUDIENCE = 'cybedefend-api';

const base64urlJson = (value: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

@Injectable()
export class AccessTokenIssuer {
  constructor(private readonly signingKeys: SigningKeyService) {}

  async issue(
    user: { id: string; email: string; firstName: string; lastName: string },
    now: Date,
  ): Promise<{ token: string; expiresAt: number }> {
    const { kid, privateKey } = await this.signingKeys.currentKey();
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + ACCESS_TOKEN_TTL_S;
    const header = { alg: 'ES256', typ: 'JWT', kid };
    const payload = {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: user.id,
      cybeid: user.id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim(),
      iat,
      exp,
    };
    const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
    const signature = cryptoSign('sha256', Buffer.from(signingInput, 'utf8'), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    return {
      token: `${signingInput}.${signature.toString('base64url')}`,
      expiresAt: exp * 1000,
    };
  }
}
