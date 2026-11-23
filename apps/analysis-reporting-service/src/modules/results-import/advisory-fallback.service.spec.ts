import { randomUUID } from 'node:crypto';
import { DataSource, FindOperator } from 'typeorm';
import { Logger } from 'nestjs-pino';
import {
  AdvisoryFallbackService,
  AdvisoryInput,
} from './advisory-fallback.service';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { VulnerabilityOsv } from '../../entities/osv/vulnerability-osv.entity';
import { VulnerabilityOsvAlias } from '../../entities/osv/vulnerability-osv-alias.entity';
import { VulnerabilityOsvSeverity } from '../../entities/osv/vulnerability-osv-severity.entity';
import { VulnerabilityOsvReference } from '../../entities/osv/vulnerability-osv-reference.entity';
import { VulnerabilityOsvAffected } from '../../entities/osv/vulnerability-osv-affected.entity';
import { VulnerabilityOsvAffectedRange } from '../../entities/osv/vulnerability-osv-affected-range.entity';
import { VulnerabilityOsvAffectedEvent } from '../../entities/osv/vulnerability-osv-affected-event.entity';

/**
 * Unit spec for the advisory fallback: `ensureAdvisories` inserts what is absent in the advisory tables and
 * never updates an existing row. The fake DataSource below records every
 * builder call and keeps an in-memory store, so the specs assert the calls
 * (never the SQL text, which differs per engine) and the stored rows.
 */

interface RecordedCall {
  method: string;
  args: unknown[];
}

type Row = Record<string, unknown>;

const fkOf = (row: Row, prop: string): string =>
  (row[prop] as { id: string }).id;

class FakeQueryBuilder {
  readonly calls: RecordedCall[] = [];

  constructor(
    private readonly harness: Harness,
    private readonly entity?: unknown,
  ) {}

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  select(...args: unknown[]): this {
    return this.record('select', args);
  }

  where(...args: unknown[]): this {
    return this.record('where', args);
  }

  async getRawMany(): Promise<unknown[]> {
    this.record('getRawMany', []);
    const where = this.calls.find((c) => c.method === 'where');
    const params = where?.args[1] as { ids?: string[] } | undefined;
    const ids = params?.ids ?? [];
    return ids
      .filter((id) => this.harness.store.roots.has(id))
      .map((id) => ({ id }));
  }

  insert(): this {
    return this.record('insert', []);
  }

  into(...args: unknown[]): this {
    return this.record('into', args);
  }

  values(...args: unknown[]): this {
    return this.record('values', args);
  }

  orIgnore(...args: unknown[]): this {
    return this.record('orIgnore', args);
  }

  orUpdate(...args: unknown[]): this {
    return this.record('orUpdate', args);
  }

  updateEntity(...args: unknown[]): this {
    return this.record('updateEntity', args);
  }

  async execute(): Promise<unknown> {
    this.record('execute', []);
    const hadOrUpdate = this.calls.some((c) => c.method === 'orUpdate');
    this.harness.statements.push(hadOrUpdate ? 'UPDATE' : 'INSERT');
    const into = this.calls.find((c) => c.method === 'into')?.args[0];
    const values = this.calls.find((c) => c.method === 'values')?.args[0] as
      | Row[]
      | undefined;
    if (into !== undefined && Array.isArray(values)) {
      // orIgnore(): a row whose id is already stored is not written — the
      // behaviour of INSERT IGNORE / ON CONFLICT DO NOTHING.
      const ignore = this.calls.some((c) => c.method === 'orIgnore');
      this.harness.insertRows(into, values, ignore);
    }
    return {};
  }
}

class Harness {
  readonly builders: FakeQueryBuilder[] = [];
  /** One entry per executed insert: 'INSERT', or 'UPDATE' if orUpdate ran. */
  readonly statements: string[] = [];
  transactionCalls = 0;
  readonly store = {
    roots: new Map<string, Row>(),
    aliases: new Map<string, Row>(),
    severities: new Map<string, Row>(),
    references: new Map<string, Row>(),
    affecteds: new Map<string, Row>(),
    ranges: new Map<string, Row>(),
    events: new Map<string, Row>(),
  };

  storeFor(entity: unknown): Map<string, Row> {
    if (entity === VulnerabilityOsv) return this.store.roots;
    if (entity === VulnerabilityOsvAlias) return this.store.aliases;
    if (entity === VulnerabilityOsvSeverity) return this.store.severities;
    if (entity === VulnerabilityOsvReference) return this.store.references;
    if (entity === VulnerabilityOsvAffected) return this.store.affecteds;
    if (entity === VulnerabilityOsvAffectedRange) return this.store.ranges;
    if (entity === VulnerabilityOsvAffectedEvent) return this.store.events;
    throw new Error('unknown entity in the fake store');
  }

  seed(entity: unknown, row: Row): void {
    this.storeFor(entity).set(String(row.id), row);
  }

  insertRows(entity: unknown, rows: Row[], ignore: boolean): void {
    const store = this.storeFor(entity);
    for (const row of rows) {
      const id = String(row.id);
      if (ignore && store.has(id)) continue;
      store.set(id, row);
    }
  }

  newBuilder(entity?: unknown, alias?: string): FakeQueryBuilder {
    const qb = new FakeQueryBuilder(this, entity);
    qb.calls.push({ method: 'createQueryBuilder', args: [entity, alias] });
    this.builders.push(qb);
    return qb;
  }

  private findRows(
    entity: unknown,
    options?: {
      where?: Record<string, unknown>;
      relations?: unknown;
    },
  ): unknown[] {
    if (entity === VulnerabilityOsv) {
      const where = options?.where as
        | { id?: FindOperator<string[]> }
        | undefined;
      const ids =
        where?.id instanceof FindOperator ? (where.id.value as string[]) : [];
      return ids
        .filter((id) => this.store.roots.has(id))
        .map((id) => {
          const root = this.store.roots.get(id) as Row;
          return {
            ...root,
            severities: [...this.store.severities.values()].filter(
              (row) => fkOf(row, 'vulnerability') === id,
            ),
            aliases: [...this.store.aliases.values()].filter(
              (row) => fkOf(row, 'vulnerability') === id,
            ),
          };
        });
    }
    const vulnWhere = options?.where?.vulnerability as
      | { id?: string }
      | undefined;
    const vulnId = vulnWhere?.id;
    const rows = [...this.storeFor(entity).values()].filter(
      (row) => fkOf(row, 'vulnerability') === vulnId,
    );
    if (entity === VulnerabilityOsvAffected) {
      return rows.map((aff) => ({
        ...aff,
        ranges: [...this.store.ranges.values()]
          .filter((range) => fkOf(range, 'affected') === aff.id)
          .map((range) => ({
            ...range,
            events: [...this.store.events.values()].filter(
              (event) => fkOf(event, 'range') === range.id,
            ),
          })),
      }));
    }
    return rows;
  }

  readonly manager = {
    find: async (
      entity: unknown,
      options?: { where?: Record<string, unknown>; relations?: unknown },
    ): Promise<unknown[]> => this.findRows(entity, options),
    createQueryBuilder: (entity?: unknown, alias?: string) =>
      this.newBuilder(entity, alias),
  };

  readonly dataSource = {
    createQueryBuilder: (entity?: unknown, alias?: string) =>
      this.manager.createQueryBuilder(entity, alias),
    manager: this.manager,
    transaction: async (
      cb: (manager: Harness['manager']) => Promise<number>,
    ): Promise<number> => {
      this.transactionCalls += 1;
      return cb(this.manager);
    },
  };

  /** The INSERT builders that targeted `entity`, with their values rows. */
  insertsInto(entity: unknown): Row[][] {
    const out: Row[][] = [];
    for (const qb of this.builders) {
      const into = qb.calls.find((c) => c.method === 'into');
      const values = qb.calls.find((c) => c.method === 'values');
      if (into && values && into.args[0] === entity) {
        out.push(values.args[0] as Row[]);
      }
    }
    return out;
  }
}

const item = (over: Partial<AdvisoryInput> = {}): AdvisoryInput => ({
  id: 'GHSA-xxxx-yyyy',
  toolName: 'trivy',
  summary: 'A summary',
  details: 'Long details',
  cweIds: ['CWE-79'],
  severity: 'high',
  cvssV3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
  helpUri: 'https://example.com/advisory',
  aliases: ['CVE-2024-1234'],
  fixes: [{ ecosystem: 'npm', packageName: 'lodash', fixed: '4.17.21' }],
  ...over,
});

interface SetupOptions {
  lockToken?: string | null;
  lockError?: unknown;
}

const setup = (opts: SetupOptions = {}) => {
  const harness = new Harness();
  const acquireDetectionCreationLock = jest.fn(async () => {
    if (opts.lockError) throw opts.lockError;
    return opts.lockToken === undefined ? 'token-1' : opts.lockToken;
  });
  const releaseDetectionCreationLock = jest.fn(async () => true);
  const scanQueue = {
    acquireDetectionCreationLock,
    releaseDetectionCreationLock,
  } as unknown as ScanQueueService;
  const logger = {
    warn: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const service = new AdvisoryFallbackService(
    harness.dataSource as unknown as DataSource,
    scanQueue,
    logger,
  );
  return {
    harness,
    service,
    acquireDetectionCreationLock,
    releaseDetectionCreationLock,
    logger,
  };
};

describe('AdvisoryFallbackService', () => {
  it('writes nothing for no item', async () => {
    const { service, harness, logger, acquireDetectionCreationLock } = setup();
    const out = await service.ensureAdvisories([]);
    expect(out.size).toBe(0);
    expect(harness.builders).toHaveLength(0);
    expect(harness.transactionCalls).toBe(0);
    expect(harness.statements).toHaveLength(0);
    expect(acquireDetectionCreationLock).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      'ADVISORY_FALLBACK roots_created=0 children_created=0',
    );
  });

  it('merges two items of one advisory: one root, the union of aliases and fixes', async () => {
    const { service, harness } = setup();
    const out = await service.ensureAdvisories([
      item({
        id: 'GHSA-1',
        aliases: ['CVE-1'],
        fixes: [{ ecosystem: 'npm', packageName: 'a', fixed: '1.0.1' }],
      }),
      item({
        id: 'GHSA-1',
        summary: 'Second summary',
        aliases: ['CVE-2', 'CVE-1'],
        fixes: [
          { ecosystem: 'npm', packageName: 'a', fixed: '1.0.2' },
          { ecosystem: 'npm', packageName: 'a', fixed: '1.0.1' },
        ],
      }),
    ]);
    // One root row, with the FIRST item's root fields.
    const rootRows = harness.insertsInto(VulnerabilityOsv);
    expect(rootRows).toHaveLength(1);
    expect(rootRows[0]).toHaveLength(1);
    expect(rootRows[0][0].summary).toBe('A summary');
    // The union of the aliases: CVE-1 and CVE-2, each once.
    const aliasRows = harness.insertsInto(VulnerabilityOsvAlias).flat();
    expect(aliasRows.map((r) => r.alias).sort()).toEqual(['CVE-1', 'CVE-2']);
    // The union of the fixes, deduplicated on the triple: two chains.
    expect(harness.insertsInto(VulnerabilityOsvAffected).flat()).toHaveLength(
      2,
    );
    expect(
      harness
        .insertsInto(VulnerabilityOsvAffectedEvent)
        .flat()
        .map((r) => r.fixed)
        .sort(),
    ).toEqual(['1.0.1', '1.0.2']);
    // The returned map holds the advisory with severities and aliases loaded.
    const advisory = out.get('GHSA-1');
    expect(advisory).toBeDefined();
    expect(advisory?.aliases.map((a) => a.alias).sort()).toEqual([
      'CVE-1',
      'CVE-2',
    ]);
    expect(advisory?.severities.map((s) => s.type).sort()).toEqual([
      'CVSS_V3',
      'DATABASE_SPECIFIC',
    ]);
  });

  it('upper-cases the DATABASE_SPECIFIC severity and writes CVSS_V3 only with a vector', async () => {
    const { service, harness } = setup();
    await service.ensureAdvisories([
      item({ id: 'GHSA-2', severity: 'critical' }),
      item({ id: 'GHSA-3', severity: 'low', cvssV3Vector: null }),
    ]);
    const rootRows = harness.insertsInto(VulnerabilityOsv)[0];
    const byId = new Map(rootRows.map((r) => [r.id, r]));
    expect(byId.get('GHSA-2')?.databaseSpecific).toEqual({
      cwe_ids: ['CWE-79'],
      severity: 'CRITICAL',
      source: 'sarif:trivy',
    });
    expect(byId.get('GHSA-3')?.databaseSpecific).toMatchObject({
      severity: 'LOW',
    });
    const severityRows = harness.insertsInto(VulnerabilityOsvSeverity).flat();
    const forTwo = severityRows.filter(
      (r) => fkOf(r, 'vulnerability') === 'GHSA-2',
    );
    expect(forTwo.map((r) => [r.type, r.score]).sort()).toEqual([
      ['CVSS_V3', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'],
      ['DATABASE_SPECIFIC', 'CRITICAL'],
    ]);
    const forThree = severityRows.filter(
      (r) => fkOf(r, 'vulnerability') === 'GHSA-3',
    );
    expect(forThree.map((r) => r.type)).toEqual(['DATABASE_SPECIFIC']);
  });

  it('writes one fix chain per fixed version, and none without one', async () => {
    const { service, harness } = setup();
    await service.ensureAdvisories([
      item({
        id: 'GHSA-4',
        fixes: [
          { ecosystem: 'npm', packageName: 'a', fixed: '1.0.1' },
          { ecosystem: 'npm', packageName: 'a', fixed: '1.0.2' },
          { ecosystem: 'PyPI', packageName: 'b', fixed: '2.0' },
        ],
      }),
      item({ id: 'GHSA-5', fixes: [] }),
    ]);
    const affectedRows = harness.insertsInto(VulnerabilityOsvAffected).flat();
    const rangeRows = harness.insertsInto(VulnerabilityOsvAffectedRange).flat();
    const eventRows = harness.insertsInto(VulnerabilityOsvAffectedEvent).flat();
    expect(affectedRows).toHaveLength(3);
    expect(rangeRows).toHaveLength(3);
    expect(eventRows).toHaveLength(3);
    // Each chain links affected → range → event, range type ECOSYSTEM,
    // affected severity null.
    for (const aff of affectedRows) {
      expect(aff.severity).toBeNull();
      const range = rangeRows.find((r) => fkOf(r, 'affected') === aff.id);
      expect(range).toBeDefined();
      expect(range?.type).toBe('ECOSYSTEM');
      const event = eventRows.find((e) => fkOf(e, 'range') === range?.id);
      expect(event).toBeDefined();
      expect(fkOf(aff, 'vulnerability')).toBe('GHSA-4');
    }
    const fixOfEvent = new Map(
      eventRows.map((e) => [fkOf(e, 'range'), e.fixed]),
    );
    expect([...fixOfEvent.values()].sort()).toEqual(['1.0.1', '1.0.2', '2.0']);
    // GHSA-5 wrote no chain at all.
    expect(
      affectedRows.filter((r) => fkOf(r, 'vulnerability') === 'GHSA-5'),
    ).toHaveLength(0);
  });

  it('writes a reference only for an https help URI', async () => {
    const { service, harness } = setup();
    await service.ensureAdvisories([
      item({ id: 'GHSA-6', helpUri: 'https://example.com/a' }),
      item({ id: 'GHSA-7', helpUri: 'http://example.com/b' }),
      item({ id: 'GHSA-8', helpUri: '' }),
    ]);
    const refRows = harness.insertsInto(VulnerabilityOsvReference).flat();
    expect(refRows).toHaveLength(1);
    expect(refRows[0]).toMatchObject({
      type: 'ADVISORY',
      url: 'https://example.com/a',
    });
    expect(fkOf(refRows[0], 'vulnerability')).toBe('GHSA-6');
  });

  it('inserts the roots with orIgnore and never issues an UPDATE', async () => {
    const { service, harness } = setup();
    await service.ensureAdvisories([item({ id: 'GHSA-9' })]);
    const rootQb = harness.builders.find((b) =>
      b.calls.some(
        (c) => c.method === 'into' && c.args[0] === VulnerabilityOsv,
      ),
    );
    expect(rootQb).toBeDefined();
    expect(rootQb?.calls).toContainEqual({ method: 'orIgnore', args: [] });
    expect(
      rootQb?.calls.find((c) => c.method === 'updateEntity')?.args,
    ).toEqual([false]);
    // Every insert builder: updateEntity(false), and no orUpdate / update
    // call anywhere — no UPDATE statement is recorded at all.
    for (const qb of harness.builders) {
      const isInsert = qb.calls.some((c) => c.method === 'insert');
      if (!isInsert) continue;
      expect(qb.calls.find((c) => c.method === 'updateEntity')?.args).toEqual([
        false,
      ]);
      expect(qb.calls.some((c) => c.method === 'orUpdate')).toBe(false);
      expect(qb.calls.some((c) => c.method === 'update')).toBe(false);
    }
    expect(harness.statements).not.toContain('UPDATE');
    expect(harness.statements).toContain('INSERT');
  });

  it('logs ADVISORY_FALLBACK_LOCK_SKIPPED and proceeds without a lock', async () => {
    const { service, harness, logger, releaseDetectionCreationLock } = setup({
      lockToken: null,
    });
    await service.ensureAdvisories([item({ id: 'GHSA-10' })]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'ADVISORY_FALLBACK_LOCK_SKIPPED advisory=GHSA-10',
    );
    expect(releaseDetectionCreationLock).not.toHaveBeenCalled();
    // It proceeded: the children were written.
    expect(harness.insertsInto(VulnerabilityOsvAlias).flat()).toHaveLength(1);
  });

  it('proceeds with one WARN when Redis fails', async () => {
    const { service, logger, harness } = setup({
      lockError: new Error('redis down'),
    });
    await service.ensureAdvisories([item({ id: 'GHSA-11' })]);
    expect(logger.warn).toHaveBeenCalledWith(
      'ADVISORY_FALLBACK_LOCK_SKIPPED advisory=GHSA-11',
    );
    expect(harness.insertsInto(VulnerabilityOsv)[0]).toHaveLength(1);
  });

  it('takes the lock per advisory id and releases it in finally', async () => {
    const {
      service,
      acquireDetectionCreationLock,
      releaseDetectionCreationLock,
    } = setup();
    await service.ensureAdvisories([
      item({ id: 'GHSA-12' }),
      item({ id: 'GHSA-13' }),
    ]);
    expect(acquireDetectionCreationLock).toHaveBeenCalledTimes(2);
    expect(acquireDetectionCreationLock).toHaveBeenCalledWith(
      'advisory:GHSA-12',
    );
    expect(acquireDetectionCreationLock).toHaveBeenCalledWith(
      'advisory:GHSA-13',
    );
    expect(releaseDetectionCreationLock).toHaveBeenCalledWith(
      'advisory:GHSA-12',
      'token-1',
    );
    expect(releaseDetectionCreationLock).toHaveBeenCalledWith(
      'advisory:GHSA-13',
      'token-1',
    );
  });

  it('keeps the children an existing advisory already has', async () => {
    const { service, harness, logger } = setup();
    harness.seed(VulnerabilityOsv, {
      id: 'GHSA-KEEP',
      summary: 'kept',
      details: 'kept',
      databaseSpecific: { severity: 'LOW' },
    });
    harness.seed(VulnerabilityOsvAlias, {
      id: randomUUID(),
      alias: 'CVE-KEEP',
      vulnerability: { id: 'GHSA-KEEP' },
    });
    harness.seed(VulnerabilityOsvSeverity, {
      id: randomUUID(),
      type: 'DATABASE_SPECIFIC',
      score: 'LOW',
      vulnerability: { id: 'GHSA-KEEP' },
    });
    const out = await service.ensureAdvisories([
      item({
        id: 'GHSA-KEEP',
        aliases: ['CVE-KEEP', 'CVE-NEW'],
        severity: 'high',
        cvssV3Vector: null,
        helpUri: '',
        fixes: [],
      }),
    ]);
    // The root insert ran with orIgnore and did not overwrite the row.
    expect(harness.store.roots.get('GHSA-KEEP')?.summary).toBe('kept');
    // Only the missing alias was inserted; the DATABASE_SPECIFIC severity
    // already exists, so no severity row at all (no vector either).
    expect(
      harness
        .insertsInto(VulnerabilityOsvAlias)
        .flat()
        .map((r) => r.alias),
    ).toEqual(['CVE-NEW']);
    expect(harness.insertsInto(VulnerabilityOsvSeverity)).toHaveLength(0);
    // The read-back still loads the stored children, plus the new alias.
    const advisory = out.get('GHSA-KEEP');
    expect(advisory?.aliases.map((a) => a.alias)).toEqual([
      'CVE-KEEP',
      'CVE-NEW',
    ]);
    expect(advisory?.severities.map((s) => s.type)).toEqual([
      'DATABASE_SPECIFIC',
    ]);
    expect(logger.log).toHaveBeenCalledWith(
      'ADVISORY_FALLBACK roots_created=0 children_created=1',
    );
  });

  it('cuts every value to its column before the insert', async () => {
    const { service, harness } = setup();
    await service.ensureAdvisories([
      item({
        id: `GHSA-${'X'.repeat(300)}`,
        summary: 'S'.repeat(1500),
        details: 'D'.repeat(25_000),
        aliases: ['A'.repeat(300)],
        fixes: [
          {
            ecosystem: 'E'.repeat(300),
            packageName: 'P'.repeat(300),
            fixed: 'F'.repeat(300),
          },
        ],
      }),
    ]);
    const root = harness.insertsInto(VulnerabilityOsv)[0][0];
    expect((root.id as string).length).toBe(255);
    expect((root.summary as string).length).toBe(1_000);
    expect((root.details as string).length).toBe(20_000);
    const alias = harness.insertsInto(VulnerabilityOsvAlias).flat()[0];
    expect((alias.alias as string).length).toBe(255);
    const affected = harness.insertsInto(VulnerabilityOsvAffected).flat()[0];
    expect((affected.ecosystem as string).length).toBe(255);
    expect((affected.packageName as string).length).toBe(255);
    const event = harness.insertsInto(VulnerabilityOsvAffectedEvent).flat()[0];
    expect((event.fixed as string).length).toBe(255);
  });

  it('never logs a summary, details or URL', async () => {
    const { service, logger } = setup();
    await service.ensureAdvisories([
      item({
        id: 'GHSA-SECRET',
        summary: 'SECRET-SUMMARY',
        details: 'SECRET-DETAILS',
        helpUri: 'https://example.com/secret-url',
        aliases: ['CVE-SECRET'],
      }),
    ]);
    const calls = [
      ...(logger.log as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
      ...(logger.error as jest.Mock).mock.calls,
    ];
    const text = JSON.stringify(calls);
    expect(text).not.toContain('SECRET-SUMMARY');
    expect(text).not.toContain('SECRET-DETAILS');
    expect(text).not.toContain('secret-url');
    expect(text).not.toContain('CVE-SECRET');
    // Counts only: 1 alias + 2 severities + 1 reference + one 3-row fix chain.
    expect(logger.log).toHaveBeenCalledWith(
      'ADVISORY_FALLBACK roots_created=1 children_created=7',
    );
  });
});
