import { randomUUID } from 'node:crypto';
import type { QueryDeepPartialEntity } from 'typeorm';
import { parseDialect } from '@cybedefend/db-dialect';
import { createLiveDatabase, type LiveDatabase } from '../../db/live-database';
import { VulnerabilityOsv } from '../../../entities/osv/vulnerability-osv.entity';
import { VulnerabilityOsvAlias } from '../../../entities/osv/vulnerability-osv-alias.entity';
import { VulnerabilityOsvSeverity } from '../../../entities/osv/vulnerability-osv-severity.entity';
import { VulnerabilityOsvReference } from '../../../entities/osv/vulnerability-osv-reference.entity';
import { VulnerabilityOsvAffected } from '../../../entities/osv/vulnerability-osv-affected.entity';
import { VulnerabilityOsvAffectedRange } from '../../../entities/osv/vulnerability-osv-affected-range.entity';
import { VulnerabilityOsvAffectedEvent } from '../../../entities/osv/vulnerability-osv-affected-event.entity';
import { ClearImportedCatalogueContent1846460000000 } from '../1846460000000-ClearImportedCatalogueContent';

/**
 * LIVE spec of the common migration 1846460000000, on the engine
 * LIVE_DB_TYPE selects:
 *
 *   AR_IMPORTED_ADVISORY_LIVE=1 LIVE_DB_TYPE=postgres \
 *     AR_IMPORTED_ADVISORY_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --ci --runInBand src/core/migrations-common/__tests__/clear-imported-catalogue-content.live.spec.ts
 *
 * Outside the Community Edition the migration issues no statement at all.
 * In the Community Edition it deletes the advisory catalogue's child rows and
 * empties the text of its roots, keeping every root (a detection's key).
 */
const LIVE = process.env.AR_IMPORTED_ADVISORY_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

const ID = 'GHSA-clear-0001-0001';

describeLive('ClearImportedCatalogueContent on a real database', () => {
  jest.setTimeout(240_000);
  const HOOK_TIMEOUT = 240_000;
  const dialect = parseDialect(process.env.LIVE_DB_TYPE);
  const ORIGINAL_EDITION = process.env.CYBEDEFEND_EDITION;
  let live: LiveDatabase;

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'ar_clear_catalogue',
      envPrefix: 'AR_IMPORTED_ADVISORY',
      dialect,
      migrations: 'track',
    });
    const insert = async <T extends object>(
      entity: new () => T,
      values: Record<string, unknown>,
    ) =>
      live.dataSource
        .createQueryBuilder()
        .insert()
        .into(entity)
        .values(values as QueryDeepPartialEntity<T>)
        .updateEntity(false)
        .execute();
    await insert(VulnerabilityOsv, {
      id: ID,
      summary: 'text an import wrote',
      details: 'details an import wrote',
      databaseSpecific: { cwe_ids: ['CWE-79'], severity: 'HIGH' },
    });
    await insert(VulnerabilityOsvAlias, {
      id: randomUUID(),
      alias: 'CVE-2024-0001',
      vulnerability: { id: ID },
    });
    await insert(VulnerabilityOsvSeverity, {
      id: randomUUID(),
      type: 'DATABASE_SPECIFIC',
      score: 'HIGH',
      vulnerability: { id: ID },
    });
    await insert(VulnerabilityOsvReference, {
      id: randomUUID(),
      type: 'ADVISORY',
      url: 'https://example.com/a',
      vulnerability: { id: ID },
    });
    const affectedId = randomUUID();
    const rangeId = randomUUID();
    await insert(VulnerabilityOsvAffected, {
      id: affectedId,
      ecosystem: 'npm',
      packageName: 'lodash',
      vulnerability: { id: ID },
    });
    await insert(VulnerabilityOsvAffectedRange, {
      id: rangeId,
      type: 'ECOSYSTEM',
      affected: { id: affectedId },
    });
    await insert(VulnerabilityOsvAffectedEvent, {
      id: randomUUID(),
      fixed: '4.17.21',
      range: { id: rangeId },
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (ORIGINAL_EDITION === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = ORIGINAL_EDITION;
    await live?.drop();
  }, HOOK_TIMEOUT);

  const counts = async () => ({
    roots: await live.dataSource.getRepository(VulnerabilityOsv).count(),
    aliases: await live.dataSource.getRepository(VulnerabilityOsvAlias).count(),
    severities: await live.dataSource
      .getRepository(VulnerabilityOsvSeverity)
      .count(),
    references: await live.dataSource
      .getRepository(VulnerabilityOsvReference)
      .count(),
    affected: await live.dataSource
      .getRepository(VulnerabilityOsvAffected)
      .count(),
    ranges: await live.dataSource
      .getRepository(VulnerabilityOsvAffectedRange)
      .count(),
    events: await live.dataSource
      .getRepository(VulnerabilityOsvAffectedEvent)
      .count(),
  });

  const runUp = async () => {
    const runner = live.dataSource.createQueryRunner();
    const query = jest.spyOn(runner, 'query');
    try {
      await new ClearImportedCatalogueContent1846460000000().up(runner);
      return query.mock.calls.length;
    } finally {
      query.mockRestore();
      await runner.release();
    }
  };

  it('outside the Community Edition, issues no statement and leaves every row', async () => {
    const before = await counts();
    for (const edition of ['cloud', 'enterprise']) {
      process.env.CYBEDEFEND_EDITION = edition;
      expect(await runUp()).toBe(0);
    }
    expect(await counts()).toEqual(before);
    expect(before).toEqual({
      roots: 1,
      aliases: 1,
      severities: 1,
      references: 1,
      affected: 1,
      ranges: 1,
      events: 1,
    });
    const root = await live.dataSource
      .getRepository(VulnerabilityOsv)
      .findOneByOrFail({ id: ID });
    expect(root.summary).toBe('text an import wrote');
  });

  it('in the Community Edition, deletes the child rows and empties the roots, keeping them', async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    await runUp();
    expect(await counts()).toEqual({
      roots: 1,
      aliases: 0,
      severities: 0,
      references: 0,
      affected: 0,
      ranges: 0,
      events: 0,
    });
    const root = await live.dataSource
      .getRepository(VulnerabilityOsv)
      .findOneByOrFail({ id: ID });
    expect(root.summary).toBeNull();
    expect(root.details).toBeNull();
    expect(root.databaseSpecific).toBeNull();
    // A second run is harmless.
    await runUp();
    expect((await counts()).roots).toBe(1);
  });
});
