import {
  Module,
  OnModuleInit,
  OnApplicationShutdown,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import Redis from 'ioredis';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { closeRedisClient } from 'src/core/redis/close-redis-client';
import { SecretsModule } from 'src/core/secrets/secrets.module';
import SecretsService from 'src/core/secrets/secrets.service';
import { MembershipRegistry } from './membership.registry';
import { RealtimeStreamFactory } from './realtime-stream.factory';
import {
  REALTIME_REDIS_SUB,
  realtimeRedisSubscriberProvider,
} from './redis-subscriber.factory';
import { OrgsRealtimeController } from './orgs-realtime.controller';
import { ProjectsRealtimeController } from './projects-realtime.controller';
import { TeamsRealtimeController } from './teams-realtime.controller';
import { TasksRealtimeController } from './tasks-realtime.controller';
import { AsyncTaskOwnerGuard } from './async-task-owner.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { StreamAuthorizer } from './stream-authorization';

const MEMBERSHIP_CONTROL_CHANNEL = 'cybe:event:membership';

@Module({
  imports: [
    ConfigModule.forRoot(),
    SecretsModule,
    JwtModule.registerAsync({
      imports: [SecretsModule],
      useFactory: async (secretsService: SecretsService) => {
        await secretsService.ensureCacheLoaded();
        const jwtSecret = secretsService.getSecret('JWT_SECRET');
        return {
          secret: jwtSecret,
          signOptions: { expiresIn: '300s' },
        };
      },
      inject: [SecretsService],
    }),
  ],
  controllers: [
    OrgsRealtimeController,
    ProjectsRealtimeController,
    TeamsRealtimeController,
    TasksRealtimeController,
  ],
  providers: [
    MembershipRegistry,
    realtimeRedisSubscriberProvider,
    RealtimeStreamFactory,
    AuthGuard,
    RateLimitGuard,
    AsyncTaskOwnerGuard,
    PermissionsGuard,
    StreamAuthorizer,
  ],
  exports: [
    MembershipRegistry,
    realtimeRedisSubscriberProvider,
    RealtimeStreamFactory,
  ],
})
export class RealtimeModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeModule.name);
  constructor(
    @Inject(REALTIME_REDIS_SUB) private readonly sub: Redis,
    private readonly membership: MembershipRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.sub.subscribe(MEMBERSHIP_CONTROL_CHANNEL);
      this.sub.on('message', (channel: string, payload: string) => {
        if (channel !== MEMBERSHIP_CONTROL_CHANNEL) return;
        try {
          const env = JSON.parse(payload);
          if (env?.type !== 'MEMBERSHIP_CHANGED') return;
          const p = env.payload?.membershipChanged;
          if (!p?.userId || !p?.scopeType || !p?.scopeId) return;
          this.membership.kick({
            userId: p.userId,
            scopeType: p.scopeType,
            scopeId: p.scopeId,
          });
          // The change may cut the access of a stream of another scope (a
          // project stream after a team removal): those re-check now.
          this.membership.recheckUser(p.userId);
        } catch (err) {
          this.logger.warn(
            `Malformed membership event: ${(err as Error).message}`,
          );
        }
      });
    } catch (err) {
      this.logger.error(
        `Failed to subscribe to membership channel: ${(err as Error).message}`,
      );
    }
  }

  /** The subscriber's socket would keep the process alive after app.close(). */
  async onApplicationShutdown(): Promise<void> {
    await closeRedisClient(this.sub);
  }
}
