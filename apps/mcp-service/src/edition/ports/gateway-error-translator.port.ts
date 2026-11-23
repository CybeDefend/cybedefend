export const GATEWAY_ERROR_TRANSLATOR = 'GATEWAY_ERROR_TRANSLATOR';

export interface GatewayErrorTranslator {
  /** null → default wrapping. */
  translate(e: unknown, warn: (line: string) => void): Error | null;
}
