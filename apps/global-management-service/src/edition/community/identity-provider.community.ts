import { Injectable } from '@nestjs/common';
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
 * The community identity provider: there is no external identity provider to
 * mirror CybeDefend's tables into, so every mirror method resolves with
 * nothing done. A member leaving an organisation is signed out of the
 * instance (`memberLeaving`). The personal access tokens of the UserService
 * RPCs are local: they live in PersonalAccessTokenStore, and `value` is ''
 * except at creation, exactly once.
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

  /** Creates a token; the secret is returned exactly once, here. */
  async createPersonalAccessToken(
    userId: string,
    name: string,
    expiresAt?: number,
  ): Promise<PersonalAccessTokenView> {
    // int64 arrives as a string at runtime (longs: String); 0 or absent = never.
    const ms = Number(expiresAt ?? 0);
    const expiry = ms > 0 ? new Date(ms) : null;
    const { pat, token } = await this.pats.create(
      userId,
      name,
      expiry,
      new Date(),
    );
    return CommunityIdentityProvider.toView(pat, token);
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
