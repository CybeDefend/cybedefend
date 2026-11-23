import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { Organization } from 'src/entities/organization.entity';
import { InMemoryOrganizationDeletionCodeStore } from 'src/test-utils/in-memory-organization-deletion-code-store';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';
import { MailService } from '../mail/mail.service';
import { OrganizationDeletionCodeService } from './organization-deletion-code.service';

/**
 * Organization deletion confirmation: creator only, a
 * 6-digit code e-mailed to the creator, valid 10 minutes, single use, 5
 * attempts, 3 sends an hour 60 s apart, a 24 h lock after 10 failures.
 * The store is the in-memory double held to the MySQL store's contract.
 */

const CREATOR = 'u-creator';
const ADMIN = 'u-admin';
const EMAIL = 'creator@example.com';
const T0 = new Date('2026-10-27T10:00:00.000Z');
const MIN = 60_000;

const organization = (): Organization =>
  ({
    id: 'o1',
    name: 'Acme',
    creator: { id: CREATOR, email: EMAIL },
  }) as unknown as Organization;

function build() {
  let now = T0.getTime();
  const clock = { advance: (ms: number) => (now += ms) };
  const store = new InMemoryOrganizationDeletionCodeStore();
  const orgRepo = { findOne: jest.fn(async () => organization()) };
  const mail = {
    sendOrganizationDeletionCodeEmail: jest.fn(async () => undefined),
    sendOrganizationDeletionLockedEmail: jest.fn(async () => undefined),
  };
  const logger = createLoggerMock();
  const service = new OrganizationDeletionCodeService(
    orgRepo as never,
    store,
    mail as unknown as MailService,
    logger as unknown as Logger,
    () => new Date(now),
  );
  /** The code the last mail carried. */
  const lastCode = (): string => {
    const calls = mail.sendOrganizationDeletionCodeEmail.mock
      .calls as unknown as [{ code: string }][];
    return calls[calls.length - 1][0].code;
  };
  const request = (requestedBy = CREATOR) =>
    service.requestCode({ organizationId: 'o1', requestedBy });
  const confirm = (code: unknown, requestedBy = CREATOR) =>
    service.confirm(organization(), requestedBy, code as string);
  return {
    service,
    store,
    orgRepo,
    mail,
    logger,
    clock,
    lastCode,
    request,
    confirm,
  };
}

async function refusal(promise: Promise<unknown>): Promise<[number, string]> {
  const thrown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(thrown).toBeInstanceOf(RpcException);
  const err = (thrown as RpcException).getError() as {
    code: number;
    message: string;
  };
  return [err.code, err.message];
}

const wrong = (code: string) =>
  String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('OrganizationDeletionCodeService.requestCode', () => {
  it('sends a 6-digit code to the creator address read from the user row, and answers its expiry', async () => {
    const t = build();
    const res = await t.request();

    expect(res).toEqual({
      expiresAt: new Date(T0.getTime() + 10 * MIN).toISOString(),
    });
    expect(t.mail.sendOrganizationDeletionCodeEmail).toHaveBeenCalledWith({
      to: EMAIL,
      organizationName: 'Acme',
      code: expect.stringMatching(/^\d{6}$/),
    });
    expect(t.orgRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'o1' },
      relations: { creator: true },
    });
  });

  it('never stores the code in clear', async () => {
    const t = build();
    await t.request();
    const row = t.store.rows.get('o1')!;
    expect(row.codeHash).not.toBe(t.lastCode());
    expect(JSON.stringify(row)).not.toContain(t.lastCode());
  });

  it.each([
    ['an administrator', ADMIN],
    ['a member', 'u-member'],
    ['a missing caller', ''],
  ])('refuses %s: NOT_ORGANIZATION_CREATOR, nothing sent', async (_who, by) => {
    const t = build();
    expect(await refusal(t.request(by))).toEqual([
      status.PERMISSION_DENIED,
      'NOT_ORGANIZATION_CREATOR',
    ]);
    expect(t.mail.sendOrganizationDeletionCodeEmail).not.toHaveBeenCalled();
    expect(t.store.rows.size).toBe(0);
  });

  it('refuses an organization without a creator: NOT_ORGANIZATION_CREATOR', async () => {
    const t = build();
    t.orgRepo.findOne.mockResolvedValueOnce({
      id: 'o1',
      name: 'Acme',
    } as never);
    expect((await refusal(t.request()))[1]).toBe('NOT_ORGANIZATION_CREATOR');
  });

  it('an unknown organization is NOT_FOUND', async () => {
    const t = build();
    t.orgRepo.findOne.mockResolvedValueOnce(null as never);
    expect((await refusal(t.request()))[0]).toBe(status.NOT_FOUND);
  });

  it('60 s between two sends, 3 an hour: DELETION_CODE_RATE_LIMITED', async () => {
    const t = build();
    await t.request();
    t.clock.advance(59_000);
    expect(await refusal(t.request())).toEqual([
      status.RESOURCE_EXHAUSTED,
      'DELETION_CODE_RATE_LIMITED',
    ]);
    t.clock.advance(1_000);
    await t.request();
    t.clock.advance(MIN);
    await t.request();
    t.clock.advance(MIN);
    expect((await refusal(t.request()))[1]).toBe('DELETION_CODE_RATE_LIMITED');
    expect(t.mail.sendOrganizationDeletionCodeEmail).toHaveBeenCalledTimes(3);
  });

  it('a new code replaces the previous one', async () => {
    const t = build();
    await t.request();
    const first = t.lastCode();
    t.clock.advance(MIN);
    await t.request();
    const second = t.lastCode();
    if (first !== second) {
      expect((await refusal(t.confirm(first)))[1]).toBe(
        'DELETION_CODE_INVALID',
      );
    }
    await expect(t.confirm(second)).resolves.toBeUndefined();
  });

  it('a mail that fails invalidates the code and answers UNAVAILABLE', async () => {
    const t = build();
    t.mail.sendOrganizationDeletionCodeEmail.mockRejectedValueOnce(
      new Error(`550 no such user ${EMAIL}`) as never,
    );
    expect((await refusal(t.request()))[0]).toBe(status.UNAVAILABLE);
    const code = t.lastCode();
    expect(t.store.rows.get('o1')!.codeHash).toBeNull();
    expect((await refusal(t.confirm(code)))[1]).toBe('DELETION_CODE_INVALID');
  });
});

describe('OrganizationDeletionCodeService.confirm', () => {
  it('accepts the code once', async () => {
    const t = build();
    await t.request();
    const code = t.lastCode();
    await expect(t.confirm(code)).resolves.toBeUndefined();
    expect(await refusal(t.confirm(code))).toEqual([
      status.INVALID_ARGUMENT,
      'DELETION_CODE_INVALID',
    ]);
  });

  it('logs the confirmation with ids only', async () => {
    const t = build();
    await t.request();
    await t.confirm(t.lastCode());
    expect(t.logger.log).toHaveBeenCalledWith(
      `ORGANIZATION_DELETION_CONFIRMED org=o1 user=${CREATOR}`,
    );
  });

  it('valid at 9:59, refused at 10:01', async () => {
    const early = build();
    await early.request();
    early.clock.advance(9 * MIN + 59_000);
    await expect(early.confirm(early.lastCode())).resolves.toBeUndefined();

    const late = build();
    await late.request();
    late.clock.advance(10 * MIN + 1_000);
    expect((await refusal(late.confirm(late.lastCode())))[1]).toBe(
      'DELETION_CODE_INVALID',
    );
  });

  it.each([undefined, '', '12345', '1234567', 'abcdef', 123456])(
    'a missing or malformed code (%p) is DELETION_CODE_INVALID',
    async (code) => {
      const t = build();
      await t.request();
      expect((await refusal(t.confirm(code)))[1]).toBe('DELETION_CODE_INVALID');
    },
  );

  it('no code was ever requested: DELETION_CODE_INVALID', async () => {
    const t = build();
    expect((await refusal(t.confirm('123456')))[1]).toBe(
      'DELETION_CODE_INVALID',
    );
  });

  it('refuses a member even with the right code, and counts no attempt', async () => {
    const t = build();
    await t.request();
    expect(await refusal(t.confirm(t.lastCode(), 'u-member'))).toEqual([
      status.PERMISSION_DENIED,
      'NOT_ORGANIZATION_CREATOR',
    ]);
    expect(t.store.rows.get('o1')!.attempts).toBe(0);
    await expect(t.confirm(t.lastCode())).resolves.toBeUndefined();
  });

  it('refuses an administrator even with the right code', async () => {
    const t = build();
    await t.request();
    expect(await refusal(t.confirm(t.lastCode(), ADMIN))).toEqual([
      status.PERMISSION_DENIED,
      'NOT_ORGANIZATION_CREATOR',
    ]);
    // …and the code stays usable by the creator.
    await expect(t.confirm(t.lastCode())).resolves.toBeUndefined();
  });

  it('5 attempts per code, then DELETION_CODE_ATTEMPTS_EXCEEDED, even with the right code', async () => {
    const t = build();
    await t.request();
    const code = t.lastCode();
    for (let i = 0; i < 5; i++) {
      expect((await refusal(t.confirm(wrong(code))))[1]).toBe(
        'DELETION_CODE_INVALID',
      );
    }
    expect(await refusal(t.confirm(code))).toEqual([
      status.FAILED_PRECONDITION,
      'DELETION_CODE_ATTEMPTS_EXCEEDED',
    ]);
  });

  it('10 failures within 24 h lock the deletion for 24 h and alert the creator once', async () => {
    const t = build();
    await t.request();
    for (let i = 0; i < 5; i++) await refusal(t.confirm(wrong(t.lastCode())));
    t.clock.advance(MIN);
    await t.request();
    for (let i = 0; i < 4; i++) await refusal(t.confirm(wrong(t.lastCode())));
    expect(t.mail.sendOrganizationDeletionLockedEmail).not.toHaveBeenCalled();

    // The tenth.
    expect(await refusal(t.confirm(wrong(t.lastCode())))).toEqual([
      status.RESOURCE_EXHAUSTED,
      'DELETION_LOCKED',
    ]);
    expect(t.mail.sendOrganizationDeletionLockedEmail).toHaveBeenCalledTimes(1);
    expect(t.mail.sendOrganizationDeletionLockedEmail).toHaveBeenCalledWith({
      to: EMAIL,
      organizationName: 'Acme',
      lockedUntil: new Date(T0.getTime() + MIN + 86_400_000),
    });

    // Every request and every confirmation is refused until then.
    t.clock.advance(2 * MIN);
    expect((await refusal(t.request()))[1]).toBe('DELETION_LOCKED');
    expect((await refusal(t.confirm('000000')))[1]).toBe('DELETION_LOCKED');
    expect((await refusal(t.confirm('bad')))[1]).toBe('DELETION_LOCKED');
    expect(t.mail.sendOrganizationDeletionLockedEmail).toHaveBeenCalledTimes(1);

    // A day later the creator can ask again.
    t.clock.advance(86_400_000);
    await expect(t.request()).resolves.toHaveProperty('expiresAt');
    await expect(t.confirm(t.lastCode())).resolves.toBeUndefined();
  });

  it('the alert mail is best-effort: its failure never fails the call', async () => {
    const t = build();
    t.mail.sendOrganizationDeletionLockedEmail.mockRejectedValue(
      new Error('smtp down') as never,
    );
    await t.request();
    for (let i = 0; i < 5; i++) await refusal(t.confirm(wrong(t.lastCode())));
    t.clock.advance(MIN);
    await t.request();
    for (let i = 0; i < 4; i++) await refusal(t.confirm(wrong(t.lastCode())));
    expect((await refusal(t.confirm(wrong(t.lastCode()))))[1]).toBe(
      'DELETION_LOCKED',
    );
  });

  it('logs never contain the code, its hash, its salt or an e-mail address', async () => {
    const t = build();
    t.mail.sendOrganizationDeletionCodeEmail.mockRejectedValueOnce(
      new Error(`550 ${EMAIL}`) as never,
    );
    await refusal(t.request());
    const failedCode = t.lastCode();
    t.clock.advance(MIN);
    await t.request();
    const code = t.lastCode();
    const row = { ...t.store.rows.get('o1')! };
    await refusal(t.confirm(wrong(code)));
    await t.confirm(code);

    const text = JSON.stringify(
      Object.values(t.logger).flatMap((m) => (m as jest.Mock).mock.calls),
      (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v),
    );
    for (const secret of [
      failedCode,
      code,
      row.codeHash!,
      row.codeSalt!,
      EMAIL,
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/@/);
  });
});
