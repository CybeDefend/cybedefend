import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';

import { MailService } from './mail.service';
import SecretsService from 'src/core/secrets/secrets.service';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';

/**
 * The scan-complete report and the legacy per-project reports are addressed to the organization creator only. They must honour that
 * user's "Email Notifications" preference (/profile → `user.notification`), like
 * the consolidated reports already do. Organization invitations are
 * transactional and stay out of that gate.
 *
 * The creator lookup is served by a stand-in query builder that projects ONLY
 * the columns the code selects, as MySQL would, and returns the raw TINYINT
 * (0/1) mysql2 yields for a boolean column — so a query that forgets to select
 * `user.notification`, or a gate comparing it to `true`/`false`, fails here.
 *
 * An unknown preference (column missing from the row, or NULL) is not an
 * opt-out: the resolver fails open so a security alert is never silently muted.
 */
type CreatorRecord = Record<string, unknown>;

interface CreatorQueryBuilder {
  innerJoin(...args: unknown[]): CreatorQueryBuilder;
  select(selection: string | string[], alias?: string): CreatorQueryBuilder;
  addSelect(selection: string | string[], alias?: string): CreatorQueryBuilder;
  getRawOne(): Promise<Record<string, unknown>>;
}

function creatorQueryBuilder(creator: CreatorRecord): CreatorQueryBuilder {
  const projection: Array<[column: string, alias: string]> = [];
  const add = (selection: string | string[], alias?: string) => {
    for (const s of Array.isArray(selection) ? selection : [selection]) {
      const aliased = /^(\S+)\s+AS\s+(\S+)$/i.exec(s.trim());
      projection.push(aliased ? [aliased[1], aliased[2]] : [s, alias ?? s]);
    }
  };
  const qb: CreatorQueryBuilder = {
    innerJoin: () => qb,
    select: (selection, alias) => {
      projection.length = 0;
      add(selection, alias);
      return qb;
    },
    addSelect: (selection, alias) => {
      add(selection, alias);
      return qb;
    },
    getRawOne: async () =>
      Object.fromEntries(
        projection
          .filter(([column]) => column in creator)
          .map(([column, alias]) => [alias, creator[column]]),
      ),
  };
  return qb;
}

type MailServiceInternals = {
  transporter: { sendMail: jest.Mock };
  render: (name: string, context: unknown) => Promise<string>;
};

function makeService(creator: CreatorRecord) {
  const svc = new MailService(
    {} as unknown as SecretsService, // transporter is replaced below
    {
      get: (key: string) =>
        key === 'FRONTEND_URL' ? 'https://app.example.com' : undefined,
    } as unknown as ConfigService,
    {
      createQueryBuilder: () => creatorQueryBuilder(creator),
    } as unknown as Repository<Organization>,
    {} as unknown as Repository<Project>, // unused by these senders
    {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger,
  );
  const internals = svc as unknown as MailServiceInternals;
  internals.transporter = { sendMail: jest.fn().mockResolvedValue(undefined) };
  jest.spyOn(internals, 'render').mockResolvedValue('<html></html>');
  return { svc, sendMail: internals.transporter.sendMail };
}

const CREATOR: CreatorRecord = {
  'user.email': 'creator@acme.io',
  'user.firstName': 'Ada',
};

const vuln = {
  id: 'v1',
  title: 'Prototype pollution in lodash',
  severity: 'CRITICAL',
  type: 'SCA',
  state: 'open',
  createdAt: '2026-09-10T08:00:00.000Z',
};
const severities = { critical: 1, high: 0, medium: 0, low: 0 };
const types = { sast: 0, iac: 0, sca: 1, container: 0 };

const CREATOR_ADDRESSED_SENDERS: Array<
  [string, (svc: MailService) => Promise<void>]
> = [
  [
    'scan-complete report',
    (svc) =>
      svc.sendScanCompleteReportEmail({
        projectId: 'p1',
        projectName: 'Alpha',
        scanId: 's1',
        severities,
        types,
        total: 1,
        topVulnerabilities: [vuln],
        scannerType: 'sca',
      }),
  ],
  [
    'legacy weekly project report',
    (svc) =>
      svc.sendWeeklyProjectReportEmail({
        projectId: 'p1',
        projectName: 'Alpha',
        severities,
        types,
        topRecent: [vuln],
        total: 1,
        newLast7d: 1,
        resolvedLast7d: 0,
      }),
  ],
  [
    'legacy monthly project report',
    (svc) =>
      svc.sendMonthlyProjectReportEmail({
        projectId: 'p1',
        projectName: 'Alpha',
        severities,
        types,
        topRecent: [vuln],
        total: 1,
        newLast30d: 1,
        resolvedLast30d: 0,
      }),
  ],
  [
    'legacy daily critical alerts',
    (svc) =>
      svc.sendDailyCriticalAlertsEmail({
        projectId: 'p1',
        projectName: 'Alpha',
        criticals: [vuln],
      }),
  ],
];

describe('MailService — creator Email Notifications opt-out', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(CREATOR_ADDRESSED_SENDERS)(
    '%s: nothing is sent when the org creator turned Email Notifications off',
    async (_label, send) => {
      const { svc, sendMail } = makeService({
        ...CREATOR,
        'user.notification': 0,
      });

      await send(svc);

      expect(sendMail).not.toHaveBeenCalled();
    },
  );

  it.each(CREATOR_ADDRESSED_SENDERS)(
    '%s: still delivered to the org creator when Email Notifications is on',
    async (_label, send) => {
      const { svc, sendMail } = makeService({
        ...CREATOR,
        'user.notification': 1,
      });

      await send(svc);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls[0][0].to).toBe('creator@acme.io');
    },
  );

  it('organization invitation is transactional: sent regardless of the opt-out', async () => {
    const { svc, sendMail } = makeService({
      ...CREATOR,
      'user.notification': 0,
    });

    await svc.sendOrganizationInviteEmail({
      id: 'i1',
      token: 'tok',
      email: 'invitee@acme.io',
      status: 'pending',
      organizationId: 'o1',
      organizationName: 'Acme',
      organizationRole: 'member',
      expiresAt: '2026-09-18T08:00:00.000Z',
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe('invitee@acme.io');
  });
});
