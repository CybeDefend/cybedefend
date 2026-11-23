export const SECRETS_SOURCE = 'SECRETS_SOURCE';

export interface SecretsSource {
  getSecret(key: string): string | undefined;
  ensureCacheLoaded(): Promise<void>;
  handleRotationEvent(): Promise<void>;
}
