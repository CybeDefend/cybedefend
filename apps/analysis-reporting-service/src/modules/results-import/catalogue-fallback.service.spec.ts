import { DataSource } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { RuleMetadata } from '@grpc/analysis-reporting/result';
import { CatalogueFallbackService } from './catalogue-fallback.service';
import {
  CatalogRule,
  catalogRuleIdOf,
  SastIacUtilsService,
} from '../sast-iac/sast-iac.utils';
import { ScanQueueService } from '../scan-queue/scan-queue.service';
import { Vulnerability } from '../../entities/vulnerability/vulnerability.entity';
import { CorrespondanceTable } from '../../entities/vulnerability/correspondance-table.entity';
import { References } from '../../entities/vulnerability/references.entity';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';

/**
 * Unit spec for the catalogue fallback: an imported rule with no
 * enabled correspondence gets a local catalogue row (`CD-<TYPE>-90001…`),
 * one correspondence and one documentation reference, written in one
 * transaction under the per-type detection creation lock, retried once in a
 * NEW transaction on a unique violation (never a savepoint, never a
 * statement after the failed one on PostgreSQL).
 */

interface RecordedCall {
  method: string;
  args: unknown[];
}

class FakeQueryBuilder {
  readonly calls: RecordedCall[] = [];

  constructor(private readonly harness: Harness) {}

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
    return this.harness.rawCodes;
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

  updateEntity(...args: unknown[]): this {
    return this.record('updateEntity', args);
  }

  update(...args: unknown[]): this {
    return this.record('update', args);
  }

  orUpdate(...args: unknown[]): this {
    return this.record('orUpdate', args);
  }

  set(...args: unknown[]): this {
    return this.record('set', args);
  }

  async execute(): Promise<unknown> {
    this.record('execute', []);
    const error = this.harness.insertErrors.shift();
    if (error) throw error;
    return {};
  }
}

class Harness {
  readonly builders: FakeQueryBuilder[] = [];
  /** Rows the existing-codes SELECT returns. */
  rawCodes: Array<{ code: string }> = [];
  /** Errors the INSERTs throw, in order (one per execute). */
  insertErrors: unknown[] = [];
  transactionCalls = 0;
  /** The detection moves: entity, criteria, values. */
  readonly moves: Array<{ entity: unknown; where: unknown; set: unknown }> = [];
  readonly manager = {
    getRepository: (entity: unknown) => ({
      update: async (where: unknown, set: unknown) => {
        this.moves.push({ entity, where, set });
        return { affected: 1 };
      },
    }),
    createQueryBuilder: (entity?: unknown, alias?: string) => {
      const qb = new FakeQueryBuilder(this);
      qb.calls.push({ method: 'createQueryBuilder', args: [entity, alias] });
      this.builders.push(qb);
      return qb;
    },
  };
  readonly dataSource = {
    transaction: async (
      cb: (manager: Harness['manager']) => Promise<number>,
    ): Promise<number> => {
      this.transactionCalls += 1;
      return cb(this.manager);
    },
    query: jest.fn(),
    createQueryBuilder: () => this.manager.createQueryBuilder(),
  };

  /** The UPDATE builders: what each one set, and on which id. */
  updates(): Array<{ set: Record<string, unknown>; id: unknown }> {
    return this.builders
      .filter((qb) => qb.calls.some((c) => c.method === 'update'))
      .map((qb) => ({
        set: qb.calls.find((c) => c.method === 'set')?.args[0] as Record<
          string,
          unknown
        >,
        id: (
          qb.calls.find((c) => c.method === 'where')?.args[1] as {
            id?: unknown;
          }
        )?.id,
      }));
  }

  /** The INSERT builders that targeted `entity`, with their values rows. */
  insertsInto(entity: unknown): Array<Record<string, unknown>[]> {
    const out: Array<Record<string, unknown>[]> = [];
    for (const qb of this.builders) {
      const into = qb.calls.find((c) => c.method === 'into');
      const values = qb.calls.find((c) => c.method === 'values');
      if (into && values && into.args[0] === entity) {
        out.push(values.args[0] as Record<string, unknown>[]);
      }
    }
    return out;
  }

  selectBuilder(): FakeQueryBuilder {
    const qb = this.builders.find((b) =>
      b.calls.some((c) => c.method === 'select'),
    );
    if (!qb) throw new Error('no SELECT builder was created');
    return qb;
  }
}

const meta = (over: Partial<RuleMetadata> = {}): RuleMetadata => ({
  toolName: 'semgrep',
  ruleId: 'rule-a',
  name: 'Rule A',
  shortDescription: 'short a',
  fullDescription: 'full a',
  helpMarkdown: 'help a',
  cwe: ['CWE-79'],
  severity: 'high',
  helpUri: 'https://example.com/rule-a',
  owaspTop10: [],
  ...over,
});

const catalogRule = (id: string, code = 'CD-SAST-0001'): CatalogRule => ({
  vulnerabilityId: `vuln-${id}`,
  code,
  vulnerabilityType: 'sast',
  name: id,
  severity: 'high',
  cwe: [],
});

interface SetupOptions {
  /** Rule ids resolveCatalogRules reports as already in the catalogue. */
  known?: string[];
  /** Rule ids already in the catalogue as rows an import created (local codes). */
  importedKnown?: string[];
  lockToken?: string | null;
  lockError?: unknown;
  /** Every project key resolves to a row an earlier import created. */
  projectRowsExist?: boolean;
}

const setup = (opts: SetupOptions = {}) => {
  const harness = new Harness();
  const resolveCatalogRules = jest.fn(async (ruleIds: string[]) => {
    const out = new Map<string, CatalogRule>();
    // As the real one: a dotted id is matched on its last segment.
    for (const id of ruleIds.map(catalogRuleIdOf)) {
      if (opts.known?.includes(id)) out.set(id, catalogRule(id));
      if (opts.importedKnown?.includes(id)) {
        out.set(id, catalogRule(id, 'CD-SAST-90023'));
      }
      if (opts.projectRowsExist && id.startsWith('imported-')) {
        out.set(id, catalogRule(id, 'CD-SAST-90031'));
      }
    }
    return out;
  });
  const sastIacUtils = {
    resolveCatalogRules,
  } as unknown as SastIacUtilsService;
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
  const service = new CatalogueFallbackService(
    harness.dataSource as unknown as DataSource,
    sastIacUtils,
    scanQueue,
    logger,
  );
  return {
    harness,
    service,
    resolveCatalogRules,
    acquireDetectionCreationLock,
    releaseDetectionCreationLock,
    logger,
  };
};

describe('CatalogueFallbackService', () => {
  it('creates nothing when every rule is known', async () => {
    const { service, harness, acquireDetectionCreationLock } = setup({
      known: ['rule-a'],
    });
    const created = await service.ensureRules('semgrep', 'sast', [meta()]);
    expect(created).toBe(0);
    expect(harness.transactionCalls).toBe(0);
    expect(acquireDetectionCreationLock).not.toHaveBeenCalled();
    expect(harness.builders).toHaveLength(0);
  });

  it('reduces a dotted rule id to its last segment', async () => {
    const { service, resolveCatalogRules, harness } = setup();
    const created = await service.ensureRules('semgrep', 'sast', [
      meta({ ruleId: 'python.lang.security.audit.eval' }),
    ]);
    expect(created).toBe(1);
    expect(resolveCatalogRules).toHaveBeenCalledWith(['eval'], 'semgrep');
    const corrRows = harness.insertsInto(CorrespondanceTable)[0];
    expect(corrRows).toHaveLength(1);
    expect(corrRows[0]).toMatchObject({
      scanner: 'semgrep',
      ruleId: 'eval',
      vulnerabilityType: 'sast',
      enabled: true,
    });
  });

  it('allocates CD-SAST-90001 then 90002 on an empty catalogue', async () => {
    const { service, harness } = setup();
    const created = await service.ensureRules('semgrep', 'sast', [
      meta({ ruleId: 'rule-a', name: 'Rule A' }),
      meta({ ruleId: 'rule-b', name: 'Rule B' }),
    ]);
    expect(created).toBe(2);
    const vulnRows = harness.insertsInto(Vulnerability)[0];
    expect(vulnRows).toHaveLength(2);
    const codes = vulnRows.map((r) => r.code).sort();
    expect(codes).toEqual(['CD-SAST-90001', 'CD-SAST-90002']);
    // Each correspondence points at the vulnerability row created for it.
    const corrRows = harness.insertsInto(CorrespondanceTable)[0];
    expect(
      corrRows.map((r) => (r.vulnerability as { id: string }).id).sort(),
    ).toEqual(vulnRows.map((r) => r.id).sort());
    // One documentation reference per rule (helpUri is set).
    const refRows = harness.insertsInto(References)[0];
    expect(refRows).toHaveLength(2);
    expect(refRows[0]).toMatchObject({
      url: 'https://example.com/rule-a',
      name: 'Rule documentation',
    });
    // Written through the insert builders with updateEntity(false), ids set.
    for (const qb of harness.builders) {
      const updateEntity = qb.calls.find((c) => c.method === 'updateEntity');
      if (updateEntity) expect(updateEntity.args[0]).toBe(false);
    }
  });

  it('resumes after the highest local code of the type', async () => {
    const { service, harness } = setup();
    harness.rawCodes = [
      { code: 'CD-SAST-90041' },
      { code: 'CD-SAST-0123' }, // registry range: ignored
      { code: 'CD-IAC-90099' }, // another type: ignored
    ];
    const created = await service.ensureRules('checkov', 'sast', [
      meta({ ruleId: 'rule-c' }),
    ]);
    expect(created).toBe(1);
    const vulnRows = harness.insertsInto(Vulnerability)[0];
    expect(vulnRows[0].code).toBe('CD-SAST-90042');
  });

  it('writes the rule OWASP labels to owaspTop10, and null when there are none', async () => {
    const { service, harness } = setup();
    await service.ensureRules('semgrep', 'sast', [
      meta({
        ruleId: 'rule-owasp',
        name: 'Rule OWASP',
        owaspTop10: ['A03:2021'],
      }),
      meta({ ruleId: 'rule-plain', name: 'Rule plain', owaspTop10: [] }),
    ]);
    const vulnRows = harness.insertsInto(Vulnerability)[0];
    const byName = new Map(vulnRows.map((r) => [r.name, r.owaspTop10]));
    expect(byName.get('Rule OWASP')).toEqual(['A03:2021']);
    expect(byName.get('Rule plain')).toBeNull();
  });

  it.each([
    ['mysql2', { code: 'ER_DUP_ENTRY', errno: 1062 }],
    ['pg', { code: '23505' }],
  ])(
    'retries once on a unique violation (%s shape), then rethrows',
    async (_label, error) => {
      const {
        service,
        harness,
        resolveCatalogRules,
        acquireDetectionCreationLock,
        releaseDetectionCreationLock,
      } = setup();
      harness.insertErrors = [error, error];
      await expect(
        service.ensureRules('semgrep', 'sast', [meta()]),
      ).rejects.toBe(error);
      // Step 2, then step 4 of both attempts: the re-check ran under the lock.
      expect(resolveCatalogRules).toHaveBeenCalledTimes(3);
      // The write ran in two separate transactions, never a savepoint.
      expect(harness.transactionCalls).toBe(2);
      // One lock for the whole call, released in finally.
      expect(acquireDetectionCreationLock).toHaveBeenCalledTimes(1);
      expect(acquireDetectionCreationLock).toHaveBeenCalledWith(
        'catalogue-fallback:SAST',
      );
      expect(releaseDetectionCreationLock).toHaveBeenCalledTimes(1);
      expect(releaseDetectionCreationLock).toHaveBeenCalledWith(
        'catalogue-fallback:SAST',
        'token-1',
      );
    },
  );

  it('rethrows any other error without a retry', async () => {
    const { service, harness, resolveCatalogRules } = setup();
    const error = { code: '23503' };
    harness.insertErrors = [error];
    await expect(service.ensureRules('semgrep', 'sast', [meta()])).rejects.toBe(
      error,
    );
    expect(harness.transactionCalls).toBe(1);
    expect(resolveCatalogRules).toHaveBeenCalledTimes(2);
  });

  it('reads the existing codes through the query builder with the CD-<TYPE>-% prefix', async () => {
    const { service, harness } = setup();
    await service.ensureRules('checkov', 'iac', [meta({ ruleId: 'rule-x' })]);
    const qb = harness.selectBuilder();
    const create = qb.calls.find((c) => c.method === 'createQueryBuilder');
    expect(create?.args[0]).toBe(Vulnerability);
    expect(create?.args[1]).toBe('v');
    expect(qb.calls.find((c) => c.method === 'select')?.args).toEqual([
      'v.code',
      'code',
    ]);
    // A plain, case-sensitive LIKE — never ilike().
    expect(qb.calls.find((c) => c.method === 'where')?.args).toEqual([
      'v.code LIKE :prefix',
      { prefix: 'CD-IAC-%' },
    ]);
    // No raw query() call anywhere.
    expect(harness.dataSource.query).not.toHaveBeenCalled();
  });

  it('proceeds with one WARN when the lock is not granted', async () => {
    const { service, harness, logger, releaseDetectionCreationLock } = setup({
      lockToken: null,
    });
    const created = await service.ensureRules('semgrep', 'sast', [meta()]);
    expect(created).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'CATALOGUE_FALLBACK_LOCK_SKIPPED tool=semgrep type=SAST',
    );
    expect(releaseDetectionCreationLock).not.toHaveBeenCalled();
    expect(harness.insertsInto(Vulnerability)[0]).toHaveLength(1);
  });

  it('proceeds with one WARN when Redis fails', async () => {
    const { service, logger } = setup({ lockError: new Error('redis down') });
    const created = await service.ensureRules('semgrep', 'secret', [meta()]);
    expect(created).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'CATALOGUE_FALLBACK_LOCK_SKIPPED tool=semgrep type=SECRET',
    );
  });

  it('writes the mapped severity, generic language and the category as the vulnerability type', async () => {
    const { service, harness } = setup();
    await service.ensureRules('gitleaks', 'secret', [
      meta({ ruleId: 'rule-s', severity: 'critical', cwe: [] }),
    ]);
    const vulnRows = harness.insertsInto(Vulnerability)[0];
    expect(vulnRows[0]).toMatchObject({
      severity: 'critical',
      language: 'generic',
      vulnerabilityType: 'secret',
      cwe: null,
      cvss3: null,
      codeExamples: null,
      sourceMetadata: null,
      description: 'full a',
      howToPrevent: 'help a',
    });
  });
});

describe('CatalogueFallbackService.catalogueRuleIds: rules imported by one organisation', () => {
  const ORG_A = '11111111-1111-4111-8111-111111111111';
  const ORG_B = '22222222-2222-4222-8222-222222222222';
  const PROJECT_1 = '33333333-3333-4333-8333-333333333333';
  const PROJECT_2 = '44444444-4444-4444-8444-444444444444';

  it('gives two projects of one organisation importing the same rule id two distinct catalogue rules', async () => {
    const { service, harness } = setup();
    const forOne = await service.catalogueRuleIds(
      'semgrep',
      'sast',
      [meta({ ruleId: 'team.sqli', name: 'Wording of project 1' })],
      ORG_A,
      PROJECT_1,
    );
    const forTwo = await service.catalogueRuleIds(
      'semgrep',
      'sast',
      [meta({ ruleId: 'team.sqli', name: 'Wording of project 2' })],
      ORG_A,
      PROJECT_2,
    );
    expect(forOne.get('team.sqli')).not.toBe(forTwo.get('team.sqli'));
    expect(
      harness
        .insertsInto(Vulnerability)
        .flat()
        .map((r) => r.name),
    ).toEqual(['Wording of project 1', 'Wording of project 2']);
  });

  it("refreshes the wording and severity of the project's own rule on a later import", async () => {
    const { service, harness } = setup({ projectRowsExist: true });
    await service.catalogueRuleIds(
      'semgrep',
      'sast',
      [meta({ ruleId: 'team.sqli', name: 'Reworded', severity: 'low' })],
      ORG_A,
      PROJECT_1,
    );
    // No new rule is created: the project's existing row is written in one
    // upsert on its primary key, which only ever updates it.
    expect(harness.transactionCalls).toBeLessThanOrEqual(1);
    const refresh = harness.builders.find((qb) =>
      qb.calls.some((c) => c.method === 'orUpdate'),
    );
    expect(refresh).toBeDefined();
    const orUpdate = refresh.calls.find((c) => c.method === 'orUpdate');
    expect(orUpdate.args[1]).toEqual(['id']);
    expect(orUpdate.args[0]).toEqual(
      expect.arrayContaining(['name', 'description', 'severity']),
    );
    const [row] = refresh.calls.find((c) => c.method === 'values')
      .args[0] as Array<Record<string, unknown>>;
    expect(row).toEqual(
      expect.objectContaining({ name: 'Reworded', severity: 'low' }),
    );
    expect(String(row.id)).toMatch(/^vuln-imported-/);
  });

  it("moves this project's findings off the organisation's former rule row", async () => {
    const { service, harness } = setup({ projectRowsExist: true });
    await service.catalogueRuleIds(
      'semgrep',
      'sast',
      [meta({ ruleId: 'team.sqli' })],
      ORG_A,
      PROJECT_1,
    );
    expect(harness.moves).toHaveLength(1);
    const [move] = harness.moves as Array<{
      entity: unknown;
      where: { projectId: string; vulnerability: { id: string } };
      set: { vulnerability: { id: string } };
    }>;
    expect(move.entity).toBe(SastVulnerabilityDetections);
    expect(move.where.projectId).toBe(PROJECT_1);
    expect(move.where.vulnerability.id).not.toBe(move.set.vulnerability.id);
  });

  it('gives two organisations importing the same rule id two distinct catalogue rules', async () => {
    const { service, harness } = setup();
    const rule = meta({ ruleId: 'team.sqli', name: 'Org A wording' });
    const forA = await service.catalogueRuleIds(
      'semgrep',
      'sast',
      [rule],
      ORG_A,
      PROJECT_1,
    );
    const forB = await service.catalogueRuleIds(
      'semgrep',
      'sast',
      [meta({ ruleId: 'team.sqli', name: 'Org B wording' })],
      ORG_B,
      PROJECT_1,
    );
    const keyA = forA.get('team.sqli');
    const keyB = forB.get('team.sqli');
    expect(keyA).toBeDefined();
    expect(keyB).toBeDefined();
    expect(keyA).not.toBe(keyB);
    // processVulnerability keys on the last dotted segment: a key has none.
    expect(keyA).not.toContain('.');
    expect(keyB).not.toContain('.');
    const corr = harness.insertsInto(CorrespondanceTable).flat();
    expect(corr.map((r) => r.ruleId)).toEqual([keyA, keyB]);
    const names = harness
      .insertsInto(Vulnerability)
      .flat()
      .map((r) => r.name);
    expect(names).toEqual(['Org A wording', 'Org B wording']);
  });

  it('keys on the full rule id, never on its last segment', async () => {
    const { service, harness } = setup();
    const keys = await service.catalogueRuleIds(
      'semgrep',
      'sast',
      [meta({ ruleId: 't4.sqli' }), meta({ ruleId: 't6.sqli' })],
      ORG_A,
      PROJECT_1,
    );
    expect(keys.get('t4.sqli')).not.toBe(keys.get('t6.sqli'));
    const corr = harness.insertsInto(CorrespondanceTable).flat();
    expect(new Set(corr.map((r) => r.ruleId)).size).toBe(2);
  });

  it('gives the same organisation the same key on every import', async () => {
    const { service } = setup();
    const first = await service.catalogueRuleIds(
      'semgrep',
      'sast',
      [meta()],
      ORG_A,
      PROJECT_1,
    );
    const second = await service.catalogueRuleIds(
      'semgrep',
      'sast',
      [meta()],
      ORG_A,
      PROJECT_1,
    );
    expect(second.get('rule-a')).toBe(first.get('rule-a'));
  });

  it("never reuses a rule another organisation's import created", async () => {
    // `sqli` is in the catalogue, but with a local code: another import made it.
    const { service, harness } = setup({ importedKnown: ['sqli'] });
    const keys = await service.catalogueRuleIds(
      'semgrep',
      'sast',
      [meta({ ruleId: 'mine.sqli', name: 'My wording' })],
      ORG_B,
      PROJECT_1,
    );
    expect(keys.get('mine.sqli')).not.toBe('mine.sqli');
    const names = harness
      .insertsInto(Vulnerability)
      .flat()
      .map((r) => r.name);
    expect(names).toEqual(['My wording']);
  });

  it('keeps a rule of the shipped catalogue as it is, and writes nothing', async () => {
    const { service, harness } = setup({ known: ['eval'] });
    const keys = await service.catalogueRuleIds(
      'semgrep',
      'sast',
      [meta({ ruleId: 'python.lang.security.audit.eval' })],
      ORG_A,
      PROJECT_1,
    );
    expect(keys.get('python.lang.security.audit.eval')).toBe(
      'python.lang.security.audit.eval',
    );
    expect(harness.transactionCalls).toBe(0);
  });
});
