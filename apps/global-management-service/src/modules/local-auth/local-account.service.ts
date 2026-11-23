import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { isUniqueViolation } from '@cybedefend/db-dialect';
import { normalizeEmail } from 'src/core/db/normalize-email';
import { User } from 'src/entities/user.entity';
import { MailService } from 'src/modules/mail/mail.service';
import { LocalCredentialStore } from './local-credential.store';
import { localAuthRefusal } from './local-auth-refusals';
import { PasswordHasher } from './password-hasher';

/**
 * A person's name is one string on the wire (`Local…Request.name`); it is
 * never split: global-management stores `firstName = name.trim()`,
 * `lastName = ''`, so the access token's `name` claim
 * (`` `${firstName} ${lastName}`.trim() ``) gives it back unchanged.
 */
export function splitName(name: string): {
  firstName: string;
  lastName: string;
} {
  return { firstName: name.trim(), lastName: '' };
}

/**
 * Creates local accounts (setup and sign-up, invitations):
 * one `user` row plus its `local_credential` row in a single transaction, the
 * user row first — a duplicate e-mail fails the INSERT, nothing runs after it
 * in the transaction, and the rollback needs no savepoint. The e-mail is
 * normalised (`trim().toLowerCase()`) on write, so the unique index behaves
 * the same on PostgreSQL (case-sensitive) as on MySQL. The welcome mail is
 * best effort, sent after the commit; its failure is logged by class name
 * only, never with the address.
 */
@Injectable()
export class LocalAccountService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly credentials: LocalCredentialStore,
    private readonly mail: MailService,
    private readonly logger: Logger,
  ) {}

  /**
   * One transaction: the user row (its first statement) + the credential.
   * A duplicate e-mail (`isUniqueViolation` on IDX_user_email_unique) rolls
   * the transaction back and answers ACCOUNT_EXISTS.
   */
  async createAccount(
    input: { email: string; password: string; name: string },
    now: Date,
  ): Promise<User> {
    const email = normalizeEmail(input.email);
    const { firstName, lastName } = splitName(input.name);
    // Hashed outside the transaction: argon2 takes ~100 ms, the writes are two
    // statements.
    const passwordHash = await this.hasher.hash(input.password);
    let user: User;
    try {
      user = await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          manager.create(User, {
            id: randomUUID(),
            email,
            firstName,
            lastName,
            picture: '',
          } as Partial<User>),
        );
        await this.credentials.set(manager, created.id, passwordHash, now);
        return created;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw localAuthRefusal('ACCOUNT_EXISTS');
      throw e;
    }
    try {
      await this.mail.sendWelcomeEmail(
        user.email,
        `${user.firstName} ${user.lastName}`.trim(),
      );
    } catch (e) {
      this.logger.error(
        `AUTH_WELCOME_MAIL_FAILED class=${LocalAccountService.name} error=${(e as Error).name}`,
      );
    }
    return user;
  }
}
