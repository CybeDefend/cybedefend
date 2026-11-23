import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { DataSource } from 'typeorm';

import SecretsService from '../../core/secrets/secrets.service';
import { ENTITLEMENTS_PORT } from '../../edition/ports/entitlements.port';
import { LinearModule } from './linear.module';
import { LinearController } from './linear.controller';
import { LinearIssueController } from './linear-issue.controller';
import { LinearService } from './linear.service';
import { LinearIssueService } from './linear-issue.service';
import { LinearFindingStatesService } from './linear-finding-states.service';
import { LinearWebhookService } from './linear-webhook.service';
import { LinearDescriptionService } from './linear-description.service';
import { LinearApiClient } from './linear-api.client';

/**
 * What AppModule provides to every module, globally: the pino Logger
 * (LoggerModule), the secrets cache (SecretsModule), the entitlements port
 * (EditionModule) and the TypeORM connection (TypeOrmModule.forRootAsync). Stubbed here so LinearModule is
 * resolved on its own; nothing connects in `preview` mode.
 */
@Global()
@Module({
  providers: [
    { provide: Logger, useValue: {} },
    { provide: SecretsService, useValue: {} },
    { provide: ENTITLEMENTS_PORT, useValue: {} },
    { provide: DataSource, useValue: {} },
  ],
  exports: [Logger, SecretsService, ENTITLEMENTS_PORT, DataSource],
})
class AppGlobalsStub {}

interface ModuleInGraph {
  metatype: { name: string };
  providers: Map<unknown, unknown>;
  controllers: Map<unknown, unknown>;
}

/**
 * LinearModule's dependency graph, resolved the way NestFactory resolves it at
 * bootstrap, without instantiating anything (`preview: true`: no database, no
 * gRPC client, no secret-store call). A provider or controller whose dependency no
 * module provides fails here with the UnknownDependenciesException a pod would
 * crash on at startup, which unit specs that build each class by hand never
 * see.
 */
describe('LinearModule bootstrap', () => {
  it('the gRPC module compiles', async () => {
    const app = await Test.createTestingModule({
      imports: [AppGlobalsStub, LinearModule],
    }).compile({ preview: true });

    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const linear = [...container.getModules().values()].find(
      (m) => m.metatype.name === 'LinearModule',
    );
    expect(linear).toBeDefined();

    const providers = [...linear!.providers.keys()];
    for (const provider of [
      LinearService,
      LinearIssueService,
      LinearFindingStatesService,
      LinearWebhookService,
      LinearDescriptionService,
      LinearApiClient,
    ]) {
      expect(providers).toContain(provider);
    }
    const controllers = [...linear!.controllers.keys()];
    expect(controllers).toContain(LinearController);
    expect(controllers).toContain(LinearIssueController);
  });
});
