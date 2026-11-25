import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import * as permify from '@permify/permify-node';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import SecretsService from 'src/core/secrets/secrets.service';
import {
  PERMIFY_PRESHARED_KEY,
  PermifyClient,
  createPermifyClient,
  warnOnceIfPermifyPresharedKeyMissing,
} from './permify-client';
import {
  isPermifyUnavailable,
  resolvePermifyDeadlineMs,
  withPermifyDeadline,
} from './permify-call-options';

function packBooleanToAny(value: boolean): { typeUrl: string; value: Buffer } {
  const bytes = permify.grpc.base.BooleanValue.encode({ data: value }).finish();
  return {
    typeUrl: 'type.googleapis.com/base.v1.BooleanValue',
    value: Buffer.from(bytes),
  };
}

/** Entity/subject pair whose relations are read in one RPC. */
export interface PermifyRelationshipFilter {
  entity: { type: string; id: string };
  subject: { type: string; id: string };
}

/** The organisation attributes that gate each product (schema.perm 1.5.0). */
export interface OrganizationProductAttributes {
  /** AppSec: plan or trial active (Stripe). */
  is_active: boolean;
  /** AppSec: reverse trial exhausted. */
  writes_blocked: boolean;
  /** The second product activated. */
  vibedefend_active: boolean;
  /** Per-member products enforced (1.5.0); left unwritten when absent. */
  member_products?: boolean;
}

/** A product, by its name on the wire (schema.perm 1.5.0). */
export type MemberProduct = 'appsec' | 'vibedefend';

/** The relation that grants each product to a member of the organisation. */
const MEMBER_PRODUCT_RELATIONS: Record<MemberProduct, string> = {
  appsec: 'appsec_user',
  vibedefend: 'vibedefend_user',
};

/**
 * Tuples per write when one product goes to many members: Permify refuses a
 * write over its `max-data-per-write` (100 by default).
 */
const TUPLES_PER_WRITE = 100;

/** An entity id that may reach a Permify filter: never empty, never a pattern. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The per-member products methods below throw what a microservice throws:
 * an RpcException with a gRPC status, never an HttpException.
 * The older methods of this file keep theirs.
 */
const invalidArgument = (message: string) =>
  new RpcException({ code: status.INVALID_ARGUMENT, message });
const internalError = (message: string) =>
  new RpcException({ code: status.INTERNAL, message });

function unpackAnyToBoolean(anyMsg?: {
  typeUrl?: string;
  value?: Buffer;
}): boolean | null {
  if (!anyMsg?.typeUrl || !anyMsg?.value) return null;
  if (anyMsg.typeUrl !== 'type.googleapis.com/base.v1.BooleanValue')
    return null;
  const decoded = permify.grpc.base.BooleanValue.decode(anyMsg.value);
  return typeof decoded?.data === 'boolean' ? decoded.data : null;
}

@Injectable()
export class PermifyService implements OnModuleInit {
  private client: PermifyClient;
  private readonly deadlineMs: number;

  constructor(
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

  /**
   * A Permify that timed out or is unreachable is our outage, not a bad
   * request: surface it as UNAVAILABLE so the gateway answers 503 instead of
   * 500. Never an HttpException — this is a microservice.
   */
  private rethrowIfPermifyUnavailable(error: unknown): void {
    if (isPermifyUnavailable(error)) {
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Authorization service unavailable',
      });
    }
  }

  async onModuleInit(): Promise<void> {
    await this.secretsService.ensureCacheLoaded();
    warnOnceIfPermifyPresharedKeyMissing(
      this.configService.get<string>('PERMIFY_ENDPOINT'),
      () => this.presharedKey(),
      (message) => this.logger.warn(message),
    );
    const schemaVersion = this.getSchemaVersion();
    if (!schemaVersion) {
      const msg =
        'PERMIFY_SCHEMA_VERSION is not set. ' +
        'Provide it as an environment variable or store it in the secrets source under the key "PERMIFY_SCHEMA_VERSION". ' +
        'You can obtain it by running the init-permify script or from the Permify admin API.';
      this.logger.error(msg);
      throw new Error(msg);
    }
    this.logger.log(
      `Permify schema version resolved: ${schemaVersion.substring(0, 12)}…`,
    );
  }

  private presharedKey(): string | undefined {
    return (
      this.configService.get<string>(PERMIFY_PRESHARED_KEY) ||
      this.secretsService.getSecret(PERMIFY_PRESHARED_KEY)
    );
  }

  /**
   * Get the schema version from config or secrets
   */
  private getSchemaVersion(): string | undefined {
    return (
      this.configService.get<string>('PERMIFY_SCHEMA_VERSION') ||
      this.secretsService.getSecret('PERMIFY_SCHEMA_VERSION')
    );
  }

  /**
   * Set organization.active (attribute is_active) to true or false
   */
  @Span()
  async setOrganizationActive(
    organizationId: string,
    active: boolean,
  ): Promise<boolean> {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    try {
      const schemaVersion = this.getSchemaVersion();

      const response = await withPermifyDeadline(this.deadlineMs, (options) =>
        this.client.data.write(
          {
            tenantId: 't1',
            metadata: {
              schemaVersion: schemaVersion || '',
            },
            attributes: [
              {
                entity: { type: 'organization', id: organizationId },
                attribute: 'is_active',
                value: packBooleanToAny(active),
              },
            ],
          },
          options,
        ),
      );

      return Boolean(response?.snapToken);
    } catch (error) {
      this.logger.error(
        `Error while setting organization active state - metadata: { orgId: ${organizationId}, active: ${active}, error: ${error} }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw new InternalServerErrorException(
        'Error while setting organization active state',
      );
    }
  }

  /**
   * Write the organisation's product attributes (schema 1.4.0) in ONE write:
   * `is_active` and `writes_blocked` are AppSec's, `vibedefend_active` is
   * the second product's. Billing owns them once a product is activated; this is used
   * at organisation creation to start from "no product".
   */
  @Span()
  async setOrganizationProductAttributes(
    organizationId: string,
    attributes: OrganizationProductAttributes,
  ): Promise<boolean> {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    try {
      const schemaVersion = this.getSchemaVersion();
      const names: (keyof OrganizationProductAttributes)[] = [
        'is_active',
        'writes_blocked',
        'vibedefend_active',
        ...(attributes.member_products === undefined
          ? []
          : (['member_products'] as const)),
      ];

      const response = await withPermifyDeadline(this.deadlineMs, (options) =>
        this.client.data.write(
          {
            tenantId: 't1',
            metadata: {
              schemaVersion: schemaVersion || '',
            },
            attributes: names.map((attribute) => ({
              entity: { type: 'organization', id: organizationId },
              attribute,
              value: packBooleanToAny(attributes[attribute]),
            })),
          },
          options,
        ),
      );

      return Boolean(response?.snapToken);
    } catch (error) {
      this.logger.error(
        `Error while setting organization product attributes - metadata: { orgId: ${organizationId}, error: ${error} }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw new InternalServerErrorException(
        'Error while setting organization product attributes',
      );
    }
  }

  /**
   * Per-member products (schema 1.5.0): make the member's `appsec_user` and
   * `vibedefend_user` tuples match `products` exactly — one write of the held
   * relations, then one delete per other relation (never the member's role:
   * each delete filters on its relation). A failure stops at the call that
   * failed; the caller decides what to restore.
   */
  @Span()
  async writeMemberProductTuples(
    organizationId: string,
    userId: string,
    products: readonly MemberProduct[],
  ): Promise<void> {
    if (!organizationId || !userId) {
      throw invalidArgument('organizationId and userId are required');
    }
    const held = (Object.keys(MEMBER_PRODUCT_RELATIONS) as MemberProduct[])
      .filter((product) => products.includes(product))
      .map((product) => MEMBER_PRODUCT_RELATIONS[product]);
    const others = Object.values(MEMBER_PRODUCT_RELATIONS).filter(
      (relation) => !held.includes(relation),
    );

    try {
      if (held.length > 0) {
        const schemaVersion = this.getSchemaVersion();
        await withPermifyDeadline(this.deadlineMs, (options) =>
          this.client.data.writeRelationships(
            {
              tenantId: 't1',
              metadata: { schemaVersion: schemaVersion || '' },
              tuples: held.map((relation) => ({
                entity: { type: 'organization', id: organizationId },
                relation,
                subject: { type: 'user', id: userId },
              })),
            },
            options,
          ),
        );
      }
      for (const relation of others) {
        await withPermifyDeadline(this.deadlineMs, (options) =>
          this.client.data.deleteRelationships(
            {
              tenantId: 't1',
              filter: {
                entity: { type: 'organization', ids: [organizationId] },
                relation,
                subject: { type: 'user', ids: [userId] },
              },
            },
            options,
          ),
        );
      }
    } catch (error) {
      this.logger.error(
        `Error while writing member product tuples - metadata: { orgId: ${organizationId}, userId: ${userId}, error: ${error} }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw internalError('Error while writing member product tuples');
    }
  }

  /**
   * One product to many members of the organisation (a product activated):
   * its relation for each of them, by writes of TUPLES_PER_WRITE tuples.
   * Writing a tuple that exists already changes nothing.
   */
  @Span()
  async grantProductTuples(
    organizationId: string,
    product: MemberProduct,
    userIds: readonly string[],
  ): Promise<void> {
    if (!organizationId) {
      throw invalidArgument('organizationId is required');
    }
    const relation = MEMBER_PRODUCT_RELATIONS[product];
    try {
      const schemaVersion = this.getSchemaVersion();
      for (let i = 0; i < userIds.length; i += TUPLES_PER_WRITE) {
        const batch = userIds.slice(i, i + TUPLES_PER_WRITE);
        await withPermifyDeadline(this.deadlineMs, (options) =>
          this.client.data.writeRelationships(
            {
              tenantId: 't1',
              metadata: { schemaVersion: schemaVersion || '' },
              tuples: batch.map((userId) => ({
                entity: { type: 'organization', id: organizationId },
                relation,
                subject: { type: 'user', id: userId },
              })),
            },
            options,
          ),
        );
      }
    } catch (error) {
      this.logger.error(
        `Error while granting a product - metadata: { orgId: ${organizationId}, product: ${product}, members: ${userIds.length}, error: ${error} }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw internalError('Error while granting a product to members');
    }
  }

  /**
   * The organisation's per-member products switch, the attribute
   * `member_products` alone (schema 1.5.0).
   */
  @Span()
  async setMemberProductsSwitch(
    organizationId: string,
    on: boolean,
  ): Promise<boolean> {
    if (!organizationId) {
      throw invalidArgument('organizationId is required');
    }
    try {
      const schemaVersion = this.getSchemaVersion();
      const response = await withPermifyDeadline(this.deadlineMs, (options) =>
        this.client.data.write(
          {
            tenantId: 't1',
            metadata: { schemaVersion: schemaVersion || '' },
            tuples: [],
            attributes: [
              {
                entity: { type: 'organization', id: organizationId },
                attribute: 'member_products',
                value: packBooleanToAny(on),
              },
            ],
          },
          options,
        ),
      );
      return Boolean(response?.snapToken);
    } catch (error) {
      this.logger.error(
        `Error while setting the member products switch - metadata: { orgId: ${organizationId}, on: ${on}, error: ${error} }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw internalError('Error while setting the member products switch');
    }
  }

  /**
   * Get organization active state by reading the is_active attribute
   */
  @Span()
  async getOrganizationActive(organizationId: string): Promise<boolean | null> {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    try {
      const resp = await withPermifyDeadline(this.deadlineMs, (options) =>
        this.client.data.readAttributes(
          {
            tenantId: 't1',
            metadata: {
              snapToken: '',
            },
            filter: {
              entity: {
                type: 'organization',
                ids: [organizationId],
              },
              attributes: ['is_active'],
            },
          },
          options,
        ),
      );

      const attr = resp?.attributes?.[0];
      if (!attr) {
        return null;
      }
      return unpackAnyToBoolean(attr.value);
    } catch (error) {
      this.logger.error(
        `Error while reading organization active state: { orgId: ${organizationId}, error: ${error} }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw new InternalServerErrorException(
        'Error while reading organization active state',
      );
    }
  }

  /**
   * Check permission for a subject on a resource
   */
  @Span()
  async checkPermission(
    resourceId: string,
    subjectId: string,
    subjectType: string = 'user',
    resourceType: string,
    permission: string,
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
      this.logger.error(
        `Error while checking permission - metadata: { error: ${error} }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw new InternalServerErrorException(
        'Error while checking permission:',
        error,
      );
    }
  }

  /**
   * Read every relation the subject holds on the entity — ONE Permify RPC.
   *
   * This replaces the "one `check` per candidate relation" loops of
   * AuthorizationService. It is equivalent to them because every
   * membership relation of the schema (`organization#administrator|manager|
   * billing_manager|member`, `team#team_manager|analyst_developer|developer|
   * read_only`) is declared `@user` — a direct relation with no userset and no
   * rewrite — so `check(entity, relation, subject)` is ALLOWED exactly when the
   * tuple `entity#relation@subject` exists, which is what this read returns.
   * The filter leaves `relation` empty (no constraint), so a single RPC yields
   * every relation linking the pair.
   *
   * `pageSize` is pinned at 100 rather than left to Permify's server-side
   * default of 50. One (entity, subject) pair holds at most one tuple per
   * declared relation (5 in this schema), so one page covers it either way —
   * pinning it only means a future change to that default cannot silently
   * start truncating this read.
   */
  @Span()
  async readRelationships(
    filter: PermifyRelationshipFilter,
  ): Promise<string[]> {
    try {
      const response = await withPermifyDeadline(this.deadlineMs, (options) =>
        this.client.data.readRelationships(
          {
            tenantId: 't1',
            metadata: {
              snapToken: '',
            },
            filter: {
              entity: {
                type: filter.entity.type,
                ids: [filter.entity.id],
              },
              subject: {
                type: filter.subject.type,
                ids: [filter.subject.id],
              },
            },
            pageSize: 100,
          },
          options,
        ),
      );

      return (response?.tuples ?? [])
        .map((tuple) => tuple.relation)
        .filter((relation): relation is string => Boolean(relation));
    } catch (error) {
      this.logger.error(
        `Error while reading relationships - metadata: { entity: ${filter.entity.type}:${filter.entity.id}, subject: ${filter.subject.type}:${filter.subject.id}, error: ${error} }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw new InternalServerErrorException(
        'Error while reading relationships:',
        error,
      );
    }
  }

  /**
   * Write permission for a subject on a resource
   */
  @Span()
  async writePermission(
    resourceId: string,
    subjectId: string,
    subjectType: string = 'user',
    resourceType: string,
    permission: string,
  ): Promise<boolean> {
    try {
      const schemaVersion =
        this.configService.get<string>('PERMIFY_SCHEMA_VERSION') ||
        this.secretsService.getSecret('PERMIFY_SCHEMA_VERSION');
      const response = await withPermifyDeadline(this.deadlineMs, (options) =>
        this.client.data.writeRelationships(
          {
            tenantId: 't1',
            metadata: {
              schemaVersion: schemaVersion,
            },
            tuples: [
              {
                entity: {
                  type: resourceType,
                  id: resourceId,
                },
                relation: permission,
                subject: {
                  type: subjectType,
                  id: subjectId,
                },
              },
            ],
          },
          options,
        ),
      );

      if (response.snapToken) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      this.logger.error(
        `Error while writing permission - metadata: { error: ${error} }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw new InternalServerErrorException(
        'Error while writing permission:',
        error,
      );
    }
  }

  /**
   * Delete permission for a subject on a resource
   */
  @Span()
  async deletePermission(
    resourceId: string,
    subjectId: string,
    subjectType: string = 'user',
    resourceType: string,
    permission: string,
  ): Promise<boolean> {
    try {
      const response = await withPermifyDeadline(this.deadlineMs, (options) =>
        this.client.data.deleteRelationships(
          {
            tenantId: 't1',
            filter: {
              entity: {
                type: resourceType,
                ids: [resourceId],
              },
              relation: permission,
              subject: {
                type: subjectType,
                ids: [subjectId],
              },
            },
          },
          options,
        ),
      );

      if (response.snapToken) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      this.logger.error(
        `Error while deleting permission - metadata: { error: ${error} }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw new InternalServerErrorException(
        'Error while deleting permission:',
        error,
      );
    }
  }

  /**
   * Deletes each of `relations` that the subject holds on the resource, one
   * delete per relation (a Permify delete filter names one relation; a
   * missing tuple is no error). Used to remove every role of a member at
   * once, whichever of them it holds, without a read that a concurrent write
   * could make stale.
   */
  @Span()
  async deleteRelationsOfSubject(
    resourceType: string,
    resourceId: string,
    subjectType: string,
    subjectId: string,
    relations: readonly string[],
  ): Promise<boolean> {
    for (const relation of relations) {
      await this.deletePermission(
        resourceId,
        subjectId,
        subjectType,
        resourceType,
        relation,
      );
    }
    return true;
  }

  /**
   * Delete all permissions for a resource
   */
  @Span()
  async deleteAllPermissions(
    resourceId: string,
    resourceType: string,
  ): Promise<boolean> {
    try {
      const response = await withPermifyDeadline(this.deadlineMs, (options) =>
        this.client.data.deleteRelationships(
          {
            tenantId: 't1',
            filter: {
              entity: {
                type: resourceType,
                ids: [resourceId],
              },
            },
          },
          options,
        ),
      );

      if (response.snapToken) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      this.logger.error(
        `Error while deleting all permissions for organization - metadata: { error: ${error} }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw new InternalServerErrorException(
        'Error while deleting all permissions for organization:',
        error,
      );
    }
  }

  /**
   * The data purge of a deleted organization (its `permify`
   * step, run after billing's): its attributes (`is_active`,
   * `writes_blocked`, `vibedefend_active`, `member_products`) and any
   * relationship still held by the organization entity, in one DeleteData.
   * Both filters name `{ type: 'organization', ids: [organizationId] }`: an
   * empty filter would delete every tenant's data, so a missing or malformed
   * id is refused before anything is sent.
   */
  @Span()
  async deleteOrganizationAttributes(organizationId: string): Promise<void> {
    if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
      throw invalidArgument('organizationId must be a UUID');
    }
    const entity = () => ({ type: 'organization', ids: [organizationId] });
    try {
      await withPermifyDeadline(this.deadlineMs, (options) =>
        this.client.data.delete(
          {
            tenantId: 't1',
            tupleFilter: { entity: entity(), relation: '', subject: undefined },
            // No attribute named: every attribute of that one organization.
            attributeFilter: { entity: entity(), attributes: [] },
          },
          options,
        ),
      );
    } catch (error) {
      this.logger.error(
        `Error while deleting organization attributes - metadata: { orgId: ${organizationId}, error: ${
          (error as Error)?.name ?? 'unknown'
        } }`,
      );
      this.rethrowIfPermifyUnavailable(error);
      throw internalError('Error while deleting organization attributes');
    }
  }
}
