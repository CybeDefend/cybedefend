import { status } from '@grpc/grpc-js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import {
  RequestOrganizationDeletionCodeRequest,
  RequestOrganizationDeletionCodeResponse,
} from '@grpc/global-management/organization';
import { Organization } from 'src/entities/organization.entity';
import { MailService } from '../mail/mail.service';
import {
  ORGANIZATION_DELETION_CODE_TTL_MS,
  deletionCodeMatches,
  generateDeletionCode,
  hashDeletionCode,
  isWellFormedDeletionCode,
  organizationDeletionRefusal,
} from './organization-deletion-code';
import type { OrganizationDeletionCodeStore } from './organization-deletion-code.store';

/** The injection token of the store (the MySQL one in the module). */
export const ORGANIZATION_DELETION_CODE_STORE = Symbol(
  'ORGANIZATION_DELETION_CODE_STORE',
);
/** The clock (`() => Date`), replaced by the specs. */
export const ORGANIZATION_DELETION_CLOCK = Symbol(
  'ORGANIZATION_DELETION_CLOCK',
);

const systemClock = () => new Date();

/**
 * Organization deletion confirmation: only the creator
 * deletes an organization, with a 6-digit code e-mailed to them, valid
 * 10 minutes and once. Every limit (5 attempts per code, 3 sends an hour
 * 60 s apart, a 24 h lock after 10 failures in 24 h) is one conditional
 * statement of the store. Logs carry ids only: never the code, its hash, its
 * salt nor an e-mail address.
 */
@Injectable()
export class OrganizationDeletionCodeService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @Inject(ORGANIZATION_DELETION_CODE_STORE)
    private readonly store: OrganizationDeletionCodeStore,
    private readonly mailService: MailService,
    private readonly logger: Logger,
    @Optional()
    @Inject(ORGANIZATION_DELETION_CLOCK)
    private readonly clock: () => Date = systemClock,
  ) {}

  /** The creator only; any other caller, or none, is refused. */
  private assertCreator(
    organization: Organization,
    requestedBy: string | undefined,
  ): string {
    const creatorId = organization.creator?.id;
    if (!requestedBy || !creatorId || creatorId !== requestedBy) {
      throw organizationDeletionRefusal('NOT_ORGANIZATION_CREATOR');
    }
    return creatorId;
  }

  async requestCode(
    request: RequestOrganizationDeletionCodeRequest,
  ): Promise<RequestOrganizationDeletionCodeResponse> {
    const organization = await this.organizationRepository.findOne({
      where: { id: request.organizationId },
      relations: { creator: true },
    });
    if (!organization) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization not found',
      });
    }
    const userId = this.assertCreator(organization, request.requestedBy);
    // The address of the creator's own user row, never one from the request.
    const to = organization.creator?.email;
    if (!to) {
      this.logger.warn(
        `ORGANIZATION_DELETION_CODE_NOT_SENT org=${organization.id} user=${userId} reason=no_address`,
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'The deletion code could not be sent',
      });
    }

    const now = this.clock();
    await this.store.ensureRow(organization.id, userId);
    const claim = await this.store.claimSend(organization.id, now);
    if (claim === 'locked')
      throw organizationDeletionRefusal('DELETION_LOCKED');
    if (claim === 'rate_limited') {
      throw organizationDeletionRefusal('DELETION_CODE_RATE_LIMITED');
    }

    const code = generateDeletionCode();
    const stored = await hashDeletionCode(code);
    const expiresAt = new Date(
      now.getTime() + ORGANIZATION_DELETION_CODE_TTL_MS,
    );
    await this.store.saveCode(organization.id, userId, stored, expiresAt);

    try {
      await this.mailService.sendOrganizationDeletionCodeEmail({
        to,
        organizationName: organization.name,
        code,
      });
    } catch (error) {
      // No valid code that nobody received.
      await this.store.discardCode(organization.id, stored.hash);
      this.logger.warn(
        `ORGANIZATION_DELETION_CODE_NOT_SENT org=${organization.id} user=${userId} error=${
          (error as Error | undefined)?.name ?? 'unknown'
        }`,
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'The deletion code could not be sent',
      });
    }

    this.logger.log(
      `ORGANIZATION_DELETION_CODE_SENT org=${organization.id} user=${userId}`,
    );
    return { expiresAt: expiresAt.toISOString() };
  }

  /**
   * Verifies and consumes the code, or throws a refusal of the closed list.
   * Called by `deleteOrganization` before anything else of the deletion.
   * `organization` must carry its `creator`.
   */
  async confirm(
    organization: Organization,
    requestedBy: string | undefined,
    code: string | undefined,
  ): Promise<void> {
    const userId = this.assertCreator(organization, requestedBy);
    const now = this.clock();

    if (await this.store.isLocked(organization.id, now)) {
      throw organizationDeletionRefusal('DELETION_LOCKED');
    }
    if (!isWellFormedDeletionCode(code)) {
      throw organizationDeletionRefusal('DELETION_CODE_INVALID');
    }

    // The attempt is counted BEFORE the comparison.
    const attempt = await this.store.countAttempt(organization.id, userId, now);
    if (attempt.outcome === 'locked') {
      throw organizationDeletionRefusal('DELETION_LOCKED');
    }
    if (attempt.outcome === 'exhausted') {
      throw organizationDeletionRefusal('DELETION_CODE_ATTEMPTS_EXCEEDED');
    }
    if (attempt.outcome !== 'allowed') {
      throw organizationDeletionRefusal('DELETION_CODE_INVALID');
    }

    if (!(await deletionCodeMatches(code, attempt.stored))) {
      const { lockedUntil } = await this.store.recordFailure(
        organization.id,
        now,
      );
      if (lockedUntil) {
        this.logger.warn(
          `ORGANIZATION_DELETION_LOCKED org=${organization.id} user=${userId} until=${lockedUntil.toISOString()}`,
        );
        await this.alertLocked(organization, lockedUntil);
        throw organizationDeletionRefusal('DELETION_LOCKED');
      }
      throw organizationDeletionRefusal('DELETION_CODE_INVALID');
    }

    // Two correct submissions at once: only one consumes the code.
    if (
      !(await this.store.consume(
        organization.id,
        userId,
        attempt.stored.hash,
        now,
      ))
    ) {
      throw organizationDeletionRefusal('DELETION_CODE_INVALID');
    }
    this.logger.log(
      `ORGANIZATION_DELETION_CONFIRMED org=${organization.id} user=${userId}`,
    );
  }

  /** Best-effort: a failed alert never fails the call. */
  private async alertLocked(
    organization: Organization,
    lockedUntil: Date,
  ): Promise<void> {
    const to = organization.creator?.email;
    if (!to) return;
    try {
      await this.mailService.sendOrganizationDeletionLockedEmail({
        to,
        organizationName: organization.name,
        lockedUntil,
      });
    } catch (error) {
      this.logger.warn(
        `ORGANIZATION_DELETION_LOCK_ALERT_FAILED org=${organization.id} error=${
          (error as Error | undefined)?.name ?? 'unknown'
        }`,
      );
    }
  }
}
