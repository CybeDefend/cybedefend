import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import type { LocalAuthSession } from '@grpc/global-management/local_auth';
import { normalizeEmail } from 'src/core/db/normalize-email';
import { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import { User } from 'src/entities/user.entity';
import { OrganizationService } from 'src/modules/organization/organization.service';
import { LocalAccountService } from './local-account.service';
import { LocalAuthService } from './local-auth.service';
import { localAuthRefusal } from './local-auth-refusals';
import { assertPasswordPolicy } from './password-policy';
import { tokenHash } from './token-hash';

/** Invitation tokens are `randomBytes(32).toString('hex')` (organization.service.ts). */
export const INVITATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The gRPC codes OrganizationService.acceptInvitationFromOrganization refuses
 * an invitation with (not found, expired, settled, sent elsewhere, a role the
 * inviter may no longer grant). Their free-text messages are not on the
 * closed list of local-auth refusals, so they answer INVITATION_INVALID.
 */
const INVITATION_REFUSAL_CODES: ReadonlySet<number> = new Set([
  status.FAILED_PRECONDITION,
  status.NOT_FOUND,
  status.PERMISSION_DENIED,
]);

/** The status of an RpcException, or of a grpc-js ServiceError (`{ code }`). */
function grpcCodeOf(e: unknown): number | undefined {
  if (e instanceof RpcException) {
    const error = e.getError();
    return typeof error === 'object' && error !== null
      ? (error as { code?: number }).code
      : undefined;
  }
  if (typeof e === 'object' && e !== null) {
    const code = (e as { code?: unknown }).code;
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

function isInvitationRefusal(e: unknown): boolean {
  const code = grpcCodeOf(e);
  return code !== undefined && INVITATION_REFUSAL_CODES.has(code);
}

/**
 * The AcceptInvitation RPC's core: accept an invitation with a new
 * local account, without Logto. The invitation is bound to its token only:
 * an existing account is never attached to it because
 * the e-mail matches — that account signs in and accepts through
 * OrganizationService's authenticated AcceptInvitation RPC, and this path
 * answers ACCOUNT_EXISTS for it. The account created here comes from the
 * token's e-mail, lower-cased like every `user.email`.
 *
 * Order: the token's shape (before any query), the invitation (unknown,
 * expired, canceled or already accepted → INVITATION_INVALID), the password
 * policy, the account existence, then createAccount →
 * acceptInvitationFromOrganization → openSession. When the acceptance fails,
 * the account created for it is deleted again (its credential row cascades),
 * so a failed acceptance leaves no half-created member behind, and a refusal
 * of OrganizationService (FAILED_PRECONDITION, NOT_FOUND, PERMISSION_DENIED)
 * answers INVITATION_INVALID; any other error is rethrown unchanged.
 *
 * No e-mail, token or password is ever logged: ids and codes only.
 */
@Injectable()
export class InvitationAcceptanceService {
  constructor(
    @InjectRepository(OrganizationInvitation)
    private readonly invitationRepository: Repository<OrganizationInvitation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly accounts: LocalAccountService,
    private readonly auth: LocalAuthService,
    private readonly organizations: OrganizationService,
    private readonly logger: Logger,
  ) {}

  async accept(
    input: { token: string; password: string; name: string },
    now: Date,
  ): Promise<{ session: LocalAuthSession; organizationId: string }> {
    if (!INVITATION_TOKEN_PATTERN.test(input.token)) {
      throw localAuthRefusal('INVITATION_INVALID');
    }
    const invitation = await this.invitationRepository.findOne({
      // Only the token's SHA-256 is stored.
      where: { tokenHash: tokenHash(input.token) },
    });
    if (
      !invitation ||
      invitation.status !== 'pending' ||
      !invitation.expiresAt ||
      invitation.expiresAt.getTime() < now.getTime()
    ) {
      throw localAuthRefusal('INVITATION_INVALID');
    }
    assertPasswordPolicy(input.password);
    const email = normalizeEmail(invitation.email);
    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing) {
      throw localAuthRefusal('ACCOUNT_EXISTS');
    }
    const user = await this.accounts.createAccount(
      { email, password: input.password, name: input.name },
      now,
    );
    let organizationId: string;
    try {
      const accepted =
        await this.organizations.acceptInvitationFromOrganization({
          token: input.token,
          userId: user.id,
        });
      if (!accepted.organization) {
        throw new RpcException({
          code: status.INTERNAL,
          message: 'Invitation accepted without an organization',
        });
      }
      organizationId = accepted.organization.id;
    } catch (e) {
      await this.deleteAccount(user.id);
      throw isInvitationRefusal(e) ? localAuthRefusal('INVITATION_INVALID') : e;
    }
    const session = await this.auth.openSession(user.id, now);
    return { session, organizationId };
  }

  /** Deletes the account created for a failed acceptance; best effort. */
  private async deleteAccount(userId: string): Promise<void> {
    try {
      // The credential row goes with the user (FK … ON DELETE CASCADE).
      await this.userRepository.delete({ id: userId });
    } catch (e) {
      this.logger.error(
        `AUTH_INVITATION_CLEANUP_FAILED user=${userId} error=${(e as Error).name}`,
      );
    }
  }
}
