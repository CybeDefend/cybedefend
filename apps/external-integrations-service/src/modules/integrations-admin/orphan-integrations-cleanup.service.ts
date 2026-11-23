import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { lastValueFrom } from 'rxjs';

import {
  ORGANIZATION_SERVICE_NAME,
  OrganizationServiceClient,
} from '@grpc/global-management/global_management';
import { IntegrationsAdminService } from './integrations-admin.service';

export interface OrphanIntegrationsCleanupResult {
  /** Organizations that own at least one integration row. */
  scanned: number;
  /** Scanned organizations global-management reports as NOT_FOUND. */
  orphans: string[];
  /** Orphans whose integrations were actually deleted. */
  deleted: string[];
  /**
   * Organizations left untouched because we could not prove they are gone
   * (existence check errored) or because their deletion failed.
   */
  skipped: string[];
  /** Set when the blast-radius cap stopped the sweep before deleting anything. */
  abortedReason?: string;
}

/**
 * How many organizations a single sweep may clean before it refuses to run.
 * A global-management pointed at the wrong database answers NOT_FOUND for
 * every organization, which is indistinguishable, org by org, from a genuine
 * orphan — this cap is what keeps that misconfiguration from wiping every
 * customer's integrations in one pass.
 */
const DEFAULT_MAX_DELETIONS = 50;

/**
 * Sweeps integration rows whose organization no longer exists.
 *
 * Integration tables live in this service's database with no FK to
 * global-management's `organizations`, so an organization deleted before the
 * teardown was wired into `deleteOrganization` left its rows behind — and with
 * them the encrypted OAuth credentials to the customer's Atlassian/Slack/…
 * tenant. Those rows are unreachable from the product: the only disconnect
 * endpoint is Permify-guarded on the very organization that no longer exists.
 *
 * Also the safety net for the fail-soft teardown: when the org-deletion cleanup
 * call fails, re-running this sweep finishes the job.
 */
@Injectable()
export class OrphanIntegrationsCleanupService implements OnModuleInit {
  private organizationGrpc!: OrganizationServiceClient;

  constructor(
    private readonly logger: Logger,
    private readonly integrationsAdmin: IntegrationsAdminService,
    @Inject('GLOBAL_MANAGEMENT_SERVICE')
    private readonly globalManagementClient: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.organizationGrpc =
      this.globalManagementClient.getService<OrganizationServiceClient>(
        ORGANIZATION_SERVICE_NAME,
      );
  }

  /**
   * @param apply - false (default) only reports what would be deleted.
   * @param maxDeletions - refuse to delete anything if the sweep finds more
   *   orphans than this. Raise it consciously once the report looks right.
   */
  async run({
    apply = false,
    maxDeletions = DEFAULT_MAX_DELETIONS,
  }: {
    apply?: boolean;
    maxDeletions?: number;
  } = {}): Promise<OrphanIntegrationsCleanupResult> {
    const organizationIds =
      await this.integrationsAdmin.listOrganizationIdsWithIntegrations();

    const result: OrphanIntegrationsCleanupResult = {
      scanned: organizationIds.length,
      orphans: [],
      deleted: [],
      skipped: [],
    };

    // Phase 1 — classify every organization before deleting anything, so the
    // blast-radius cap sees the full picture.
    for (const organizationId of organizationIds) {
      const exists = await this.organizationExists(organizationId);

      // Only a definitive NOT_FOUND authorises a deletion. Anything else
      // (UNAVAILABLE, DEADLINE_EXCEEDED, …) means we could not prove the org is
      // gone, and deleting on that basis would wipe a live customer's
      // integrations.
      if (exists === false) {
        result.orphans.push(organizationId);
      } else if (exists === null) {
        result.skipped.push(organizationId);
      }
    }

    if (!apply) {
      return result;
    }

    if (result.orphans.length > maxDeletions) {
      result.abortedReason =
        `${result.orphans.length} orphan(s) exceeds the ${maxDeletions} cap — ` +
        'nothing deleted. Check that global-management points at the right ' +
        'database, then re-run with a higher cap.';
      this.logger.error(
        { orphans: result.orphans.length, maxDeletions },
        'orphan integrations sweep aborted by the blast-radius cap',
      );
      return result;
    }

    // Phase 2 — delete.
    for (const organizationId of result.orphans) {
      try {
        const deletedCounts =
          await this.integrationsAdmin.deleteIntegrationsForOrg(
            organizationId,
            IntegrationsAdminService.ALL_TYPES,
          );
        result.deleted.push(organizationId);
        this.logger.log(
          { organizationId, deletedCounts },
          'orphan integrations deleted',
        );
      } catch (e) {
        result.skipped.push(organizationId);
        this.logger.error(
          { err: (e as Error).message, organizationId },
          'orphan integrations deletion failed',
        );
      }
    }

    return result;
  }

  /**
   * @returns true if the organization exists, false if global-management
   * answered NOT_FOUND, null if the question could not be answered.
   */
  private async organizationExists(
    organizationId: string,
  ): Promise<boolean | null> {
    try {
      await lastValueFrom(this.organizationGrpc.get({ organizationId }));
      return true;
    } catch (e) {
      if ((e as { code?: number })?.code === status.NOT_FOUND) {
        return false;
      }
      this.logger.error(
        { err: (e as Error).message, organizationId },
        'organization existence check failed — leaving its integrations alone',
      );
      return null;
    }
  }
}
