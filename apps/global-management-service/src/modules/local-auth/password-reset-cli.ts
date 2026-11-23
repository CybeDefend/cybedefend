import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { PasswordResetService } from './password-reset.service';

/** Where the CLI writes: stdout for the link, stderr for the errors. */
export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/**
 * The admin CLI behind `pnpm run auth:reset-password -- <email>`
 * (main.auth-reset-password.ts): it issues a reset link for a local
 * account, for instances that run without SMTP. The link is written to stdout
 * only, never to the logger; the exit code is 0 on success, 2 when no local
 * account has the e-mail (NO_LOCAL_ACCOUNT, fixed sentence on stderr), 1 on
 * any other error (the error's class name only on stderr — a driver error can
 * quote customer data). pnpm 10 may forward the `--` of
 * `pnpm run auth:reset-password -- <email>`, so the first argument that is not
 * `--` is the e-mail.
 */
@Injectable()
export class PasswordResetCli {
  constructor(
    private readonly reset: PasswordResetService,
    private readonly logger: Logger,
  ) {}

  /** Runs the CLI; returns the process exit code. */
  async run(argv: string[], io: CliIo): Promise<number> {
    const email = argv.slice(2).find((arg) => arg !== '--');
    if (!email) {
      io.stderr('Usage: pnpm run auth:reset-password -- <email>\n');
      return 1;
    }
    try {
      const link = await this.reset.issueLinkForCli(email, new Date());
      io.stdout(`${link}\n`);
      return 0;
    } catch (e) {
      if ((e as Error).message === 'NO_LOCAL_ACCOUNT') {
        io.stderr('No local account for this e-mail\n');
        return 2;
      }
      const className = (e as Error)?.constructor?.name ?? 'Error';
      this.logger.error(`AUTH_RESET_CLI_FAILED error=${className}`);
      io.stderr(`${className}\n`);
      return 1;
    }
  }
}
