import 'reflect-metadata';
import type { Logger } from 'nestjs-pino';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';
import { PasswordResetCli } from './password-reset-cli';
import { PasswordResetService } from './password-reset.service';

/**
 * Unit spec of the password-reset CLI: the link goes to stdout only,
 * never to the logger; exit 0 on success, 2 with the fixed sentence on
 * NO_LOCAL_ACCOUNT, 1 with the error's class name on any other error. pnpm 10
 * may forward the `--` of `pnpm run auth:reset-password -- <email>`, so the
 * first argument that is not `--` is the e-mail.
 */

const LINK = 'https://app.example.test/reset-password#token=the-token';

describe('PasswordResetCli', () => {
  let reset: { issueLinkForCli: jest.Mock };
  let logger: ReturnType<typeof createLoggerMock>;
  let cli: PasswordResetCli;
  let stdout: jest.Mock;
  let stderr: jest.Mock;

  beforeEach(() => {
    reset = { issueLinkForCli: jest.fn() };
    logger = createLoggerMock();
    cli = new PasswordResetCli(
      reset as unknown as PasswordResetService,
      logger as unknown as Logger,
    );
    stdout = jest.fn();
    stderr = jest.fn();
  });

  const run = (argv: string[]) => cli.run(argv, { stdout, stderr });

  it('writes the link to stdout and exits 0', async () => {
    reset.issueLinkForCli.mockResolvedValue(LINK);

    const code = await run([
      'node',
      'main.auth-reset-password',
      'admin@example.test',
    ]);

    expect(code).toBe(0);
    expect(reset.issueLinkForCli).toHaveBeenCalledWith(
      'admin@example.test',
      expect.any(Date),
    );
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(`${LINK}\n`);
    expect(stderr).not.toHaveBeenCalled();
    // the link never reaches the logger
    for (const m of [logger.log, logger.warn, logger.error, logger.debug]) {
      expect(m).not.toHaveBeenCalled();
    }
  });

  it('skips a leading --', async () => {
    reset.issueLinkForCli.mockResolvedValue(LINK);

    const code = await run(['node', 'main', '--', 'admin@example.test']);

    expect(code).toBe(0);
    expect(reset.issueLinkForCli).toHaveBeenCalledWith(
      'admin@example.test',
      expect.any(Date),
    );
  });

  it('exits 2 with the fixed sentence on NO_LOCAL_ACCOUNT', async () => {
    reset.issueLinkForCli.mockRejectedValue(new Error('NO_LOCAL_ACCOUNT'));

    const code = await run(['node', 'main', '--', 'nobody@example.test']);

    expect(code).toBe(2);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledWith('No local account for this e-mail\n');
    expect(stdout).not.toHaveBeenCalled();
  });

  it('exits 1 with the error class name only on any other error', async () => {
    reset.issueLinkForCli.mockRejectedValue(
      new TypeError('connection refused'),
    );

    const code = await run(['node', 'main', 'admin@example.test']);

    expect(code).toBe(1);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledWith('TypeError\n');
    expect(stdout).not.toHaveBeenCalled();
    // the logger carries the class name, never the message (which may quote data)
    const logged = [logger.error, logger.warn, logger.log, logger.debug]
      .flatMap((m) => m.mock.calls)
      .flat()
      .map(String);
    expect(logged.some((line) => line.includes('TypeError'))).toBe(true);
    expect(logged.some((line) => line.includes('connection refused'))).toBe(
      false,
    );
  });

  it('exits 1 with a usage line when no e-mail is given', async () => {
    const code = await run(['node', 'main']);

    expect(code).toBe(1);
    expect(reset.issueLinkForCli).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0][0])).toContain('auth:reset-password');
  });
});
