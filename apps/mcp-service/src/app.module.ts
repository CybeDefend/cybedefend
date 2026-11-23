import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { OpenTelemetryModule } from 'nestjs-otel';
import { LoggerModule } from './core/logger/logger.module';
import { validationSchema } from './core/config/validation.schema';
import { AuthGuard } from './core/guards/auth/auth.guard';
import { HealthController } from './health/health.controller';
import { McpModule } from './modules/mcp/mcp.module';
import { OverviewModule } from './modules/overview/overview.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { PostureModule } from './modules/posture/posture.module';
import { SastModule } from './modules/sast/sast.module';
import { ScaModule } from './modules/sca/sca.module';
import { IacModule } from './modules/iac/iac.module';
import { CicdModule } from './modules/cicd/cicd.module';
import { SecretModule } from './modules/secret/secret.module';
import { ContainerModule } from './modules/container/container.module';
import { VulnerabilitiesModule } from './modules/vulnerabilities/vulnerabilities.module';
import { EditionModule } from './edition/edition.module';
import { editionImports } from './edition/edition-imports';

@Module({
  imports: [
    OpenTelemetryModule.forRoot({ metrics: { hostMetrics: false } }),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema,
    }),
    EditionModule.forRoot(),
    LoggerModule,
    McpModule,
    DiscoveryModule,
    OverviewModule,
    PostureModule,
    SastModule,
    ScaModule,
    IacModule,
    CicdModule,
    SecretModule,
    ContainerModule,
    VulnerabilitiesModule,
    ...editionImports(),
  ],
  controllers: [HealthController],
  providers: [
    Logger,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    // OAUTH_STATE_STORE is provided by OAuthModule, which is its
    // only consumer — declaring it here too would yield a second instance and
    // split the bindings between them.
  ],
})
export class AppModule {}
