import tracer from './tracer';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';
import { Logger } from 'nestjs-pino';
import { isCommunityEdition } from './edition/edition';
import { PasswordResetCli } from './modules/local-auth/password-reset-cli';

/**
 * One-shot entrypoint of the password-reset CLI: boots the
 * AuthResetPasswordCliModule, issues a reset link for the e-mail given as the
 * first argument that is not `--` (pnpm 10 may forward the `--` of
 * `pnpm run auth:reset-password -- <email>`), writes the link to stdout and
 * exits with the CLI's code: 0 on success, 2 when no local account has the
 * e-mail, 1 on any other error (the error's class name only, on stderr).
 *
 * Community Edition only: in the cloud edition it refuses before booting
 * anything (no tracer, no configuration, no database) and exits 1. The root
 * module is imported only after that check, since importing it already
 * validates the configuration.
 *
 * Local run: pnpm run auth:reset-password:dev -- admin@example.test
 * Built run: pnpm run auth:reset-password -- admin@example.test
 */
async function bootstrap() {
  if (!isCommunityEdition()) {
    process.stderr.write('auth:reset-password is Community Edition only\n');
    process.exit(1);
    return;
  }
  await tracer.start();
  dotenv.config();
  const { AuthResetPasswordCliModule } =
    await import('./auth-reset-password.cli.module');
  const app = await NestFactory.createApplicationContext(
    AuthResetPasswordCliModule,
    {
      logger: ['log', 'error', 'warn'],
    },
  );
  const logger = app.get(Logger);

  try {
    const code = await app.get(PasswordResetCli).run(process.argv, {
      stdout: (line) => process.stdout.write(line),
      stderr: (line) => process.stderr.write(line),
    });
    await app.close();
    process.exit(code);
  } catch (err) {
    // The class only: a driver or service error can quote customer data.
    logger.error(
      `Password reset CLI failed: ${(err as Error)?.constructor?.name ?? 'unknown'}`,
    );
    await app.close().catch(() => undefined);
    process.exit(1);
  }
}
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console -- the bootstrap failed before a logger existed
  console.error(
    'Fatal error in password reset CLI bootstrap:',
    (err as Error)?.constructor?.name ?? 'unknown',
  );
  process.exit(1);
});
