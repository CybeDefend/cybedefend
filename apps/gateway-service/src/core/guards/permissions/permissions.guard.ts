import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Span } from 'nestjs-otel';
import { ConfigService } from '@nestjs/config';
import * as permify from '@permify/permify-node';
import {
  PERMIFY_PRESHARED_KEY,
  PermifyClient,
  createPermifyClient,
  warnOnceIfPermifyPresharedKeyMissing,
} from 'src/core/utils/permify-client';
import { Logger } from 'nestjs-pino';
import SecretsService from 'src/core/secrets/secrets.service';
import {
  isPermifyUnavailable,
  resolvePermifyDeadlineMs,
  withPermifyDeadline,
} from 'src/core/utils/permify-call-options';

@Injectable()
export class PermissionsGuard implements CanActivate, OnModuleInit {
  private client: PermifyClient;
  private readonly deadlineMs: number;

  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
    private secretsService: SecretsService,
    private readonly logger: Logger,
  ) {
    this.client = createPermifyClient(
      this.configService.get<string>('PERMIFY_ENDPOINT'),
      () => this.presharedKey(),
    );
    this.deadlineMs = resolvePermifyDeadlineMs(
      this.configService.get<string>('PERMIFY_RPC_DEADLINE_MS'),
    );
  }

  /** One boot warning, process-wide, when no preshared key resolves. */
  async onModuleInit(): Promise<void> {
    await this.secretsService.ensureCacheLoaded();
    warnOnceIfPermifyPresharedKeyMissing(
      this.configService.get<string>('PERMIFY_ENDPOINT'),
      () => this.presharedKey(),
      (message) => this.logger.warn(message),
    );
  }

  private presharedKey(): string | undefined {
    return (
      this.configService.get<string>(PERMIFY_PRESHARED_KEY) ||
      this.secretsService.getSecret(PERMIFY_PRESHARED_KEY)
    );
  }

  @Span()
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const message = context.switchToHttp().getRequest();
    if (!message) throw new ForbiddenException('Permission denied');

    const request: any = message;
    const handler = context.getHandler();

    // Read the metadata, always as arrays
    const subjectTypes = this.toArray(
      this.reflector.get<string | string[]>('subjectTypes', handler),
    );
    const permissions = this.toArray(
      this.reflector.get<string | string[]>('permissions', handler),
    );

    // Check that both lists have the same length
    if (subjectTypes.length !== permissions.length) {
      throw new InternalServerErrorException(
        'Configuration error: permissions and subjectTypes arrays must have the same length',
      );
    }

    let allValid = true;
    for (let i = 0; i < permissions.length; i++) {
      const permission = permissions[i];
      const subjectType = subjectTypes[i];

      let subjectId: string;
      if (subjectType === 'organization' && request.params.organizationId) {
        subjectId = request.params.organizationId;
      } else if (subjectType === 'team' && request.params.teamId) {
        subjectId = request.params.teamId;
      } else if (subjectType === 'project' && request.params.projectId) {
        subjectId = request.params.projectId;
      } else {
        allValid = false;
        continue;
      }

      const isValid = await this.validatePermission(
        request,
        subjectId,
        subjectType,
        permission,
      );
      if (!isValid) {
        allValid = false;
        throw new ForbiddenException('Permission denied');
      }
    }

    if (!allValid) {
      throw new ForbiddenException('Permission denied');
    }

    await this.assertChildrenInOrganization(request.params, subjectTypes);

    return true;
  }

  /**
   * Each permission above is checked on its own path id, which proves nothing
   * about how those ids relate. A route that names an organization and a
   * project (or a team) acts on that child with the organization's settings
   * and integrations, so the child must belong to that organization: without
   * this, a caller pairs an organization they administer with a project of
   * another organization where they only hold a project permission. The
   * answer is the same 403 as a missing permission, and a Permify failure is
   * never an allow.
   */
  private async assertChildrenInOrganization(
    params: Record<string, string | undefined>,
    subjectTypes: string[],
  ): Promise<void> {
    if (!subjectTypes.includes('organization')) return;
    const organizationId = params.organizationId;
    const children: Array<[string, string | undefined]> = [
      ['project', params.projectId],
      ['team', params.teamId],
    ];
    for (const [childType, childId] of children) {
      if (!subjectTypes.includes(childType)) continue;
      const inOrganization = await this.checkPermission(
        childId,
        childType,
        'organization',
        organizationId,
        'organization',
      );
      if (!inOrganization) {
        throw new ForbiddenException('Permission denied');
      }
    }
  }

  private toArray(value: string | string[]): string[] {
    return Array.isArray(value) ? value : [value];
  }

  @Span()
  private async validatePermission(
    request: any,
    subjectId: string,
    subjectType: string,
    permission: string,
  ): Promise<boolean> {
    if (request.user) {
      if (!request.user.sub) {
        throw new ForbiddenException('Permission denied, invalid user');
      }

      return this.checkPermission(
        subjectId,
        subjectType,
        permission,
        request.user.sub,
        'user',
      );
    } else {
      throw new ForbiddenException('Permission denied, no authenticated user');
    }
  }

  @Span()
  async checkPermission(
    resourceId: string,
    resourceType: string,
    permission: string,
    subjectId: string,
    subjectType: string = 'user',
  ): Promise<boolean> {
    try {
      const schemaVersion =
        this.configService.get<string>('PERMIFY_SCHEMA_VERSION') ||
        this.secretsService.getSecret('PERMIFY_SCHEMA_VERSION');
      const response = await withPermifyDeadline(this.deadlineMs, (options) =>
        this.client.permission.check(
          {
            tenantId: 't1',
            metadata: {
              snapToken: '',
              schemaVersion: schemaVersion,
              depth: 100,
            },
            entity: {
              type: resourceType,
              id: resourceId,
            },
            permission: permission,
            subject: {
              type: subjectType,
              id: subjectId,
            },
          },
          options,
        ),
      );

      return (
        response.can === permify.grpc.base.CheckResult.CHECK_RESULT_ALLOWED
      );
    } catch (error) {
      this.logger.error(error);
      // Permify was too slow or unreachable: that is our outage, not the
      // caller's bad request, so say 503 (and stay fail-closed — this never
      // returns true).
      if (isPermifyUnavailable(error)) {
        throw new ServiceUnavailableException(
          'Authorization service unavailable',
        );
      }
      throw new InternalServerErrorException(
        'Error while checking permission, aborting request to the server for security reasons',
      );
    }
  }
}
