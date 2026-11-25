import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type {
  IdentityOrganization,
  IdentityProviderPort,
  IdentityUser,
  PersonalAccessTokenView,
} from '../ports/identity-provider.port';
import {
  type LocalPat,
  PersonalAccessTokenStore,
} from 'src/modules/local-auth/personal-access-token.store';
import { RefreshTokenStore } from 'src/modules/local-auth/refresh-token.store';

/**
 * Why the generic token routes refuse to create a personal access token in
 * this edition, and where to create one instead: a token outlives every
 * session, so creating one takes the account's password, which only
 * POST /me/personal-access-tokens asks for. The code before the colon is
 * stable; the gateway answers it as a 400.
 */
export const PAT_PASSWORD_REQUIRED_MESSAGE =
  'PAT_PASSWORD_REQUIRED: create personal access tokens with POST /me/personal-access-tokens, which asks for the account password';

/**
 * The community identity provider: there is no external identity provider to
 * mirror CybeDefend's tables into, so every mirror method resolves with
 * nothing done. A member leaving an organisation is signed out of the
 * instance (`memberLeaving`). The personal access tokens of the UserService
 * RPCs are local: they live in PersonalAccessTokenStore, and `value` is ''.
 * They list, delete and rename; they never create (see
 * {@link PAT_PASSWORD_REQUIRED_MESSAGE}).
 */
@Injectable()
export class CommunityIdentityProvider implements IdentityProviderPort {
  constructor(
    private readonly pats: PersonalAccessTokenStore,
    private readonly refreshTokens: RefreshTokenStore,
  ) {}

  async organizationCreated(): Promise<void> {}

  async organizationRenamed(): Promise<void> {}

  async organizationDeleted(): Promise<void> {}

  async invitationCreated(): Promise<void> {}

  async invitationCanceled(): Promise<void> {}

  async memberAdded(): Promise<void> {}

  async memberRoleChanged(): Promise<void> {}

  /**
   * Revokes every refresh session and every personal access token of the
   * leaving member. Removal cuts the organisation's permissions, but a
   * session or a token kept from before would still let the account act
   * elsewhere on the instance (create an organisation, start scans). The
   * account signs in again and keeps the organisations it still belongs to;
   * an access token already issued lives out its short lifetime. Runs before
   * the membership is removed and rejects on failure, so a failed sign-out
   * leaves the member in place and the removal can be retried.
   */
  async memberLeaving(
    _organization: IdentityOrganization,
    user: IdentityUser,
  ): Promise<void> {
    const now = new Date();
    await this.refreshTokens.revokeAllOfUser(user.id, now);
    await this.pats.revokeAllOfUser(user.id, now);
  }

  async userDeleted(): Promise<void> {}

  /** No copy of the membership to drop: the removal always goes on. */
  async removeMember(): Promise<void> {}

  private static toView(pat: LocalPat, value: string): PersonalAccessTokenView {
    return {
      name: pat.name,
      value,
      createdAt: pat.createdAt.getTime(),
      expiresAt: pat.expiresAt ? pat.expiresAt.getTime() : 0,
    };
  }

  /** Active tokens, newest first; the secret value is never listed. */
  async listPersonalAccessTokens(
    userId: string,
  ): Promise<PersonalAccessTokenView[]> {
    const tokens = await this.pats.list(userId, new Date());
    return tokens.map((pat) => CommunityIdentityProvider.toView(pat, ''));
  }

  /**
   * Refused: this path carries no password, and a token outlives every
   * session, so a session alone must not mint one. FAILED_PRECONDITION
   * (a 400 at the gateway) with PAT_PASSWORD_REQUIRED, which names the route
   * that asks for the password. Nothing is created.
   */
  async createPersonalAccessToken(
    userId: string,
    name: string,
    expiresAt?: number,
  ): Promise<PersonalAccessTokenView> {
    void userId; // the port's signature: nothing of the request is used
    void name;
    void expiresAt;
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: PAT_PASSWORD_REQUIRED_MESSAGE,
    });
  }

  async deletePersonalAccessToken(userId: string, name: string): Promise<void> {
    await this.pats.revokeByName(userId, name, new Date());
  }

  async renamePersonalAccessToken(
    userId: string,
    currentName: string,
    newName: string,
  ): Promise<PersonalAccessTokenView> {
    const pat = await this.pats.rename(userId, currentName, newName);
    return CommunityIdentityProvider.toView(pat, '');
  }

  async countPersonalAccessTokensForOrganization(
    organizationId: string,
  ): Promise<number> {
    return this.pats.countActiveForOrganization(organizationId, new Date());
  }

  async deleteAllPersonalAccessTokensForOrganization(
    organizationId: string,
  ): Promise<number> {
    return this.pats.revokeAllForOrganization(organizationId, new Date());
  }
}
