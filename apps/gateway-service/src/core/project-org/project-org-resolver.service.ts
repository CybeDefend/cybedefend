import { Inject, Injectable } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';

import {
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
} from '@grpc/global-management/global_management';
import { wrapGrpcClientWithTracing } from '@grpc/traced-grpc-client';

/** Projects whose organization is kept in memory, per gateway process. */
const MAX_ENTRIES = 5000;
/** How long an entry is trusted before global-management is asked again. */
const TTL_MS = 60 * 60 * 1000;

/**
 * The organization a project belongs to, kept in memory.
 *
 * FeatureGuard (routes under `:projectId`) and a closed extension would
 * otherwise ask global-management for it on every request. The link never changes: a project's team is set when it is
 * created and nothing moves it (`updateProject` ignores `teamId`), nor does a
 * team change organization. This is not an authorization cache: whether the
 * caller may read the project is still checked by Permify on every request.
 *
 * Least recently used entries go first past 5,000 projects; an entry is
 * trusted for an hour. A failed lookup, or an answer without an organization,
 * is never kept, and concurrent lookups of one project share one call.
 */
@Injectable()
export class ProjectOrgResolver {
  private orgClient?: OrganizationServiceClient;
  private readonly entries = new Map<
    string,
    { organizationId: string; expiresAt: number }
  >();
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(
    @Inject('GLOBAL_MANAGEMENT_SERVICE') private readonly gmGrpc: ClientGrpc,
  ) {}

  /**
   * The project's organization id, or null when global-management answers
   * without one. Rejects with the gRPC error when the lookup fails.
   */
  resolve(projectId: string): Promise<string | null> {
    const entry = this.entries.get(projectId);
    if (entry) {
      this.entries.delete(projectId);
      if (entry.expiresAt > Date.now()) {
        this.entries.set(projectId, entry); // most recently used goes last
        return Promise.resolve(entry.organizationId);
      }
    }
    const pending = this.inFlight.get(projectId);
    if (pending) return pending;

    const lookup = this.lookup(projectId).finally(() =>
      this.inFlight.delete(projectId),
    );
    this.inFlight.set(projectId, lookup);
    return lookup;
  }

  private async lookup(projectId: string): Promise<string | null> {
    const res = await lastValueFrom(
      this.client().getOrganizationIdByProjectId({ projectId }),
    );
    const organizationId = res?.organizationId || null;
    if (organizationId) {
      if (this.entries.size >= MAX_ENTRIES) {
        this.entries.delete(this.entries.keys().next().value);
      }
      this.entries.set(projectId, {
        organizationId,
        expiresAt: Date.now() + TTL_MS,
      });
    }
    return organizationId;
  }

  private client(): OrganizationServiceClient {
    this.orgClient ??= wrapGrpcClientWithTracing(
      this.gmGrpc.getService<OrganizationServiceClient>(
        ORGANIZATION_SERVICE_NAME,
      ),
    );
    return this.orgClient;
  }
}
