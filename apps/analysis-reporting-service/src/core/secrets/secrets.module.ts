import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { SECRETS_SOURCE } from '../../edition/ports/secrets.port';
import { SecretRotationController } from './secret-rotation.controller';
import { secretsBindings } from './secrets-bindings';
import SecretsService from './secrets.service';

/**
 * Wires the secrets source itself (not EditionModule) so that the modules
 * importing SecretsModule keep compiling through the alias.
 */
@Global()
@Module({
  imports: [ConfigModule, HttpModule],
  providers: [...secretsBindings(), SecretsService],
  exports: [SecretsService, SECRETS_SOURCE],
  controllers: [SecretRotationController],
})
export class SecretsModule {}
