import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/entities/user.entity';
import { Team } from 'src/entities/team.entity';
import { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import { MailModule } from 'src/modules/mail/mail.module';
import { OrganizationModule } from 'src/modules/organization/organization.module';
import { AccessTokenIssuer } from './access-token.issuer';
import { AuthOneTimeToken } from './entities/auth-one-time-token.entity';
import { AuthRefreshToken } from './entities/auth-refresh-token.entity';
import { AuthSigningKey } from './entities/auth-signing-key.entity';
import { InvitationAcceptanceService } from './invitation-acceptance.service';
import { LocalCredential } from './entities/local-credential.entity';
import { LocalPersonalAccessTokenEntity } from './entities/personal-access-token.entity';
import { LocalAccountService } from './local-account.service';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthService } from './local-auth.service';
import { LocalCredentialStore } from './local-credential.store';
import { OneTimeTokenStore } from './one-time-token.store';
import { PasswordHasher } from './password-hasher';
import { PasswordResetService } from './password-reset.service';
import { PersonalAccessTokenStore } from './personal-access-token.store';
import { RefreshTokenStore } from './refresh-token.store';
import { ResetRequesterKeyer } from './reset-requester-key';
import { SetupService } from './setup.service';
import { SigningKeyService } from './signing-key.service';

/**
 * The Community Edition's local identity, loaded only through
 * COMMUNITY_ONLY_MODULES: in the cloud no handler binds `LocalAuthService`,
 * so every call answers UNIMPLEMENTED. The local-identity tables exist in
 * every edition (common migration), but only this module reads or writes
 * them. SigningKeyService and ResetRequesterKeyer read their keys from the
 * secrets source in onModuleInit, after secrets.ensureCacheLoaded(). The setup
 * and sign-up
 * reach OrganizationService (exported by OrganizationModule) and MailService
 * (exported by MailModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Team,
      OrganizationInvitation,
      LocalCredential,
      AuthRefreshToken,
      AuthOneTimeToken,
      LocalPersonalAccessTokenEntity,
      AuthSigningKey,
    ]),
    OrganizationModule,
    MailModule,
  ],
  controllers: [LocalAuthController],
  providers: [
    LocalAuthService,
    LocalAccountService,
    SetupService,
    InvitationAcceptanceService,
    PasswordHasher,
    LocalCredentialStore,
    SigningKeyService,
    AccessTokenIssuer,
    RefreshTokenStore,
    PersonalAccessTokenStore,
    OneTimeTokenStore,
    ResetRequesterKeyer,
    PasswordResetService,
  ],
  // PasswordResetService is exported for the auth:reset-password CLI
  // (auth-reset-password.cli.module.ts).
  exports: [LocalAuthService, PasswordResetService],
})
export class LocalAuthModule {}
