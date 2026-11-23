/**
 * The identity provider port: what the core tells the external identity
 * provider (Logto in the cloud) about CybeDefend's own organisations,
 * invitations, members and users, and the personal access tokens of the
 * UserService RPCs. The community edition mirrors nothing and keeps its
 * personal access tokens in a local store.
 */
export const IDENTITY_PROVIDER_PORT = 'IDENTITY_PROVIDER_PORT';

/** An edition's identity provider may add its own fields (its own ids). */
export interface IdentityOrganization {
  id: string;
  name: string;
}

export interface IdentityUser {
  id: string;
  email: string;
  logtoUserId?: string | null;
}

export interface IdentityInvitation {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  logtoInvitationId?: string | null;
}

/** Epoch ms; `value` is '' except at creation. */
export interface PersonalAccessTokenView {
  name: string;
  value: string;
  createdAt: number;
  expiresAt: number;
}

export interface IdentityProviderPort {
  // Mirror of CybeDefend's own tables in the identity provider. Never
  // rejects: a failure is logged as today.
  organizationCreated(
    organization: IdentityOrganization,
    creator: IdentityUser,
  ): Promise<void>;
  organizationRenamed(organization: IdentityOrganization): Promise<void>;
  organizationDeleted(organization: IdentityOrganization): Promise<void>;
  invitationCreated(
    organization: IdentityOrganization,
    invitation: IdentityInvitation,
    inviter: IdentityUser,
  ): Promise<void>;
  invitationCanceled(
    invitation: IdentityInvitation & { organizationId: string },
  ): Promise<void>;
  memberAdded(
    organization: IdentityOrganization,
    user: IdentityUser,
    role: string,
  ): Promise<void>;
  memberRoleChanged(
    organization: IdentityOrganization,
    user: IdentityUser,
    role: string,
  ): Promise<void>;
  // Called once a removal from the organisation is allowed, BEFORE anything
  // is removed. A rejection stops the removal and leaves the member in
  // place, so it can be retried.
  memberLeaving(
    organization: IdentityOrganization,
    user: IdentityUser,
  ): Promise<void>;
  userDeleted(user: IdentityUser): Promise<void>;
  // Asked BEFORE the core removes a member: the provider drops its own copy
  // of the membership first, and a rejection (RpcException) aborts the
  // removal with nothing changed. A membership the provider kept would come
  // back at its next membership sync, with the role it had there.
  removeMember(
    organization: IdentityOrganization,
    user: IdentityUser,
  ): Promise<void>;
  // Personal access tokens of the UserService RPCs. Reject with RpcException
  // as today.
  listPersonalAccessTokens(userId: string): Promise<PersonalAccessTokenView[]>;
  createPersonalAccessToken(
    userId: string,
    name: string,
    expiresAt?: number,
  ): Promise<PersonalAccessTokenView>;
  deletePersonalAccessToken(userId: string, name: string): Promise<void>;
  renamePersonalAccessToken(
    userId: string,
    currentName: string,
    newName: string,
  ): Promise<PersonalAccessTokenView>;
  countPersonalAccessTokensForOrganization(
    organizationId: string,
  ): Promise<number>;
  deleteAllPersonalAccessTokensForOrganization(
    organizationId: string,
  ): Promise<number>;
}
