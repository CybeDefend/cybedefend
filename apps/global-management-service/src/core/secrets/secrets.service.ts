import { Inject, Injectable } from '@nestjs/common';
import {
  SECRETS_SOURCE,
  SecretsSource,
} from '../../edition/ports/secrets.port';
import { registerServiceAuthKeySource } from '../service-auth/service-auth.edition';

/**
 * Public API unchanged (getSecret / ensureCacheLoaded / handleRotationEvent);
 * it is now a pure delegate. The source bound to SECRETS_SOURCE owns the whole
 * precedence: environment, then <KEY>_FILE, then the keys derived from
 * CYBEDEFEND_SECRET_KEY in the Community Edition; the cloud source its own.
 */
@Injectable()
export default class SecretsService {
  constructor(@Inject(SECRETS_SOURCE) private readonly source: SecretsSource) {
    // Service-to-service authentication reads its key like any other secret.
    registerServiceAuthKeySource((name) => this.source.getSecret(name));
  }

  getSecret(key: string): string | undefined {
    return this.source.getSecret(key);
  }

  async ensureCacheLoaded(): Promise<void> {
    await this.source.ensureCacheLoaded();
  }

  async handleRotationEvent(): Promise<void> {
    await this.source.handleRotationEvent();
  }
}
