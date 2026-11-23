/**
 * What the auth routes answer for a session.
 * The refresh token never travels in a body: it is the cookie.
 */
export interface TokenAnswer {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/**
 * `accessTokenExpiresAt` is an int64 in ms, which the gRPC loader hands over
 * as a string (`longs: String`): read with Number() before any arithmetic.
 */
export function toTokenAnswer(
  session: { accessToken: string; accessTokenExpiresAt: string | number },
  nowMs: number = Date.now(),
): TokenAnswer {
  const seconds = Math.round(
    (Number(session.accessTokenExpiresAt) - nowMs) / 1000,
  );
  return {
    accessToken: session.accessToken,
    tokenType: 'Bearer',
    expiresIn: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
  };
}
