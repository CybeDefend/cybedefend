import { DataSource } from 'typeorm';
import { Logger } from 'nestjs-pino';
import {
  AdvisoryFallbackService,
  AdvisoryInput,
  AdvisoryScope,
} from './advisory-fallback.service';
import { ImportedAdvisory } from '../../entities/imported-advisory.entity';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { IMPORTED_ADVISORY_LIMITS } from './imported-advisory.view';

/**
 * Unit spec for the advisory fallback. The fake DataSource records every
 * insert (target, values, orIgnore / orUpdate) and answers the two reads
 * (the catalogue roots that exist, the project's stored rows). The engines
 * themselves are covered by advisory-fallback.live.spec.ts.
 */

type Row = Record<string, unknown>;

interface Insert {
  into: unknown;
  values: Row[];
  orIgnore: boolean;
  orUpdate: unknown[] | null;
}

class Fake {
  readonly inserts: Insert[] = [];
  existingRoots = new Set<string>();
  storedRows: Row[] = [];

  /** The statements the project's advisory lock ran, in order. */
  readonly lockStatements: string[] = [];
  lockGranted = true;

  readonly dataSource = {
    createQueryBuilder: (entity?: unknown) => this.builder(entity),
    createQueryRunner: () => ({
      manager: { connection: { options: { type: 'postgres' } } },
      connect: async () => undefined,
      release: async () => undefined,
      query: async (text: string) => {
        this.lockStatements.push(text);
        return { records: [{ acquired: this.lockGranted }] };
      },
    }),
    manager: {
      find: async (target: unknown) =>
        target === ImportedAdvisory ? this.storedRows : [],
    },
  } as unknown as DataSource;

  private builder(entity?: unknown) {
    const state: Insert = {
      into: entity,
      values: [],
      orIgnore: false,
      orUpdate: null,
    };
    let ids: string[] = [];
    const qb = {
      select: () => qb,
      where: (_: string, params: { chunk: string[] }) => {
        ids = params.chunk;
        return qb;
      },
      getRawMany: async () =>
        ids.filter((id) => this.existingRoots.has(id)).map((id) => ({ id })),
      insert: () => qb,
      into: (target: unknown) => {
        state.into = target;
        return qb;
      },
      values: (values: Row[]) => {
        state.values = values;
        return qb;
      },
      orIgnore: () => {
        state.orIgnore = true;
        return qb;
      },
      orUpdate: (...args: unknown[]) => {
        state.orUpdate = args;
        return qb;
      },
      updateEntity: () => qb,
      execute: async () => {
        this.inserts.push(state);
        return {};
      },
    };
    return qb;
  }

  insertsInto(target: unknown): Insert[] {
    return this.inserts.filter((i) => i.into === target);
  }
}

const item = (over: Partial<AdvisoryInput> = {}): AdvisoryInput => ({
  id: 'GHSA-unit-1',
  toolName: 'trivy',
  summary: 'summary',
  details: 'details',
  cweIds: ['CWE-79'],
  severity: 'high',
  cvssV3Vector: null,
  helpUri: 'https://example.com/a',
  aliases: ['CVE-2024-0001'],
  fixes: [{ ecosystem: 'npm', packageName: 'lodash', fixed: '4.17.21' }],
  ...over,
});

const SCOPE: AdvisoryScope = {
  projectId: 'project-1',
  organizationId: 'org-1',
  scanId: 'scan-1',
};

describe('AdvisoryFallbackService', () => {
  let fake: Fake;
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let service: AdvisoryFallbackService;

  beforeEach(() => {
    fake = new Fake();
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = new AdvisoryFallbackService(
      fake.dataSource,
      logger as unknown as Logger,
    );
  });

  it('writes nothing for no item', async () => {
    await service.ensureAdvisories(SCOPE, []);
    expect(fake.inserts).toEqual([]);
    expect(fake.lockStatements).toEqual([]);
  });

  it('gives the shared catalogue an id-only root, with orIgnore, and only for an unknown id', async () => {
    fake.existingRoots.add('GHSA-known');
    await service.ensureAdvisories(SCOPE, [
      item({ id: 'GHSA-new' }),
      item({ id: 'GHSA-known' }),
    ]);
    const roots = fake.insertsInto(VulnerabilityOsv);
    expect(roots).toHaveLength(1);
    expect(roots[0].orIgnore).toBe(true);
    expect(roots[0].orUpdate).toBeNull();
    expect(roots[0].values).toEqual([{ id: 'GHSA-new' }]);
    // nothing else of the catalogue is ever written
    const targets = new Set(fake.inserts.map((i) => i.into));
    expect([...targets].sort()).toEqual(
      [ImportedAdvisory, VulnerabilityOsv].sort(),
    );
  });

  it("upserts the project's row with what the import declared", async () => {
    await service.ensureAdvisories(SCOPE, [
      item({ severity: 'critical', cvssV3Vector: 'CVSS:3.1/AV:N' }),
    ]);
    const [upsert] = fake.insertsInto(ImportedAdvisory);
    expect(upsert.orUpdate?.[1]).toEqual(['projectId', 'advisoryId']);
    expect(upsert.values).toEqual([
      expect.objectContaining({
        projectId: 'project-1',
        organizationId: 'org-1',
        scanId: 'scan-1',
        advisoryId: 'GHSA-unit-1',
        toolName: 'trivy',
        summary: 'summary',
        severity: 'critical',
        cvssV3Vector: 'CVSS:3.1/AV:N',
        cweIds: ['CWE-79'],
        aliases: ['CVE-2024-0001'],
        referenceUrls: ['https://example.com/a'],
        fixes: [{ ecosystem: 'npm', packageName: 'lodash', fixed: '4.17.21' }],
      }),
    ]);
  });

  it('merges the items of one id: the first gives the text, the collections are the union', async () => {
    await service.ensureAdvisories(SCOPE, [
      item({ aliases: ['CVE-1'], fixes: [] }),
      item({
        summary: 'other',
        severity: 'low',
        aliases: ['CVE-1', 'CVE-2'],
        fixes: [{ ecosystem: 'npm', packageName: 'a', fixed: '1.0.1' }],
      }),
    ]);
    const [{ values }] = fake.insertsInto(ImportedAdvisory);
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({
      summary: 'summary',
      severity: 'high',
      aliases: ['CVE-1', 'CVE-2'],
      fixes: [{ ecosystem: 'npm', packageName: 'a', fixed: '1.0.1' }],
    });
  });

  it('keeps a row of the same import and adds to it; replaces a row of an earlier import', async () => {
    fake.storedRows = [
      {
        projectId: 'project-1',
        advisoryId: 'GHSA-same',
        scanId: 'scan-1',
        toolName: 'trivy',
        summary: 'kept',
        details: '',
        severity: 'medium',
        cvssV3Vector: null,
        cweIds: [],
        aliases: ['CVE-OLD'],
        referenceUrls: [],
        fixes: [],
      },
      {
        projectId: 'project-1',
        advisoryId: 'GHSA-earlier',
        scanId: 'scan-0',
        toolName: 'trivy',
        summary: 'earlier',
        details: '',
        severity: 'medium',
        cvssV3Vector: null,
        cweIds: [],
        aliases: ['CVE-EARLIER'],
        referenceUrls: [],
        fixes: [],
      },
    ];
    await service.ensureAdvisories(SCOPE, [
      item({ id: 'GHSA-same', aliases: ['CVE-NEW'] }),
      item({ id: 'GHSA-earlier', aliases: ['CVE-NEW'] }),
    ]);
    const [{ values }] = fake.insertsInto(ImportedAdvisory);
    const byId = new Map(values.map((v) => [v.advisoryId, v]));
    expect(byId.get('GHSA-same')).toMatchObject({
      summary: 'kept',
      severity: 'medium',
      aliases: ['CVE-OLD', 'CVE-NEW'],
    });
    expect(byId.get('GHSA-earlier')).toMatchObject({
      summary: 'summary',
      severity: 'high',
      aliases: ['CVE-NEW'],
    });
  });

  it('bounds every collection and cuts the text', async () => {
    const many = Array.from({ length: 300 }, (_, i) => i);
    await service.ensureAdvisories(SCOPE, [
      item({
        summary: 's'.repeat(5_000),
        details: 'd'.repeat(50_000),
        aliases: many.map((i) => `CVE-${i}`),
        cweIds: many.map((i) => `CWE-${i}`),
        fixes: many.map((i) => ({
          ecosystem: 'npm',
          packageName: 'p',
          fixed: `1.${i}`,
        })),
      }),
      ...many.map((i) => item({ helpUri: `https://example.com/${i}` })),
    ]);
    const [{ values }] = fake.insertsInto(ImportedAdvisory);
    const row = values[0] as Record<string, unknown[] | string>;
    expect(row.aliases).toHaveLength(IMPORTED_ADVISORY_LIMITS.aliases);
    expect(row.cweIds).toHaveLength(IMPORTED_ADVISORY_LIMITS.cweIds);
    expect(row.fixes).toHaveLength(IMPORTED_ADVISORY_LIMITS.fixes);
    expect(row.referenceUrls).toHaveLength(
      IMPORTED_ADVISORY_LIMITS.referenceUrls,
    );
    expect(row.summary).toHaveLength(1_000);
    expect(row.details).toHaveLength(20_000);
  });

  it('keeps a reference only for an https URI', async () => {
    await service.ensureAdvisories(SCOPE, [
      item({ id: 'a', helpUri: 'http://example.com/a' }),
      item({ id: 'b', helpUri: 'javascript:alert(1)' }),
      item({ id: 'c', helpUri: '' }),
    ]);
    const [{ values }] = fake.insertsInto(ImportedAdvisory);
    for (const value of values) expect(value.referenceUrls).toEqual([]);
  });

  it("writes the project's rows under its database lock, and releases it", async () => {
    await service.ensureAdvisories(SCOPE, [item()]);
    expect(fake.lockStatements).toHaveLength(2);
    expect(fake.lockStatements[0]).toContain('pg_try_advisory_lock');
    expect(fake.lockStatements[1]).toContain('pg_advisory_unlock');
    expect(fake.insertsInto(ImportedAdvisory)).toHaveLength(1);
  });

  it('never writes the rows without the lock', async () => {
    fake.lockGranted = false;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const pending = service.ensureAdvisories(SCOPE, [item()]);
      const outcome = pending.catch((error: Error) => error);
      await jest.advanceTimersByTimeAsync(61_000);
      expect(await outcome).toMatchObject({ code: 'ADVISORY_LOCK_TIMEOUT' });
    } finally {
      jest.useRealTimers();
    }
    expect(fake.insertsInto(ImportedAdvisory)).toHaveLength(0);
  });

  it('never logs a summary, details or URL', async () => {
    await service.ensureAdvisories(SCOPE, [
      item({ summary: 'SECRET-SUMMARY', details: 'SECRET-DETAILS' }),
    ]);
    const logged = JSON.stringify([
      logger.log.mock.calls,
      logger.warn.mock.calls,
    ]);
    expect(logged).not.toMatch(/SECRET|example\.com/);
  });
});
