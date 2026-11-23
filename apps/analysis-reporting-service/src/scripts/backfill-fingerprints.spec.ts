import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { of } from 'rxjs';
import { Logger } from 'nestjs-pino';
import {
  applyFingerprints,
  backfillCodeTable,
  buildCodeFingerprintRows,
  buildContainerFingerprintRows,
  buildScaFingerprintRows,
  collisionReport,
  lastCompleteGroupBoundary,
  parsePageSize,
  refuseClaimedFingerprints,
} from './backfill-fingerprints';
import { ScaService } from '../modules/sca/sca.service';
import { ContainerService } from '../modules/container/container.service';
import { ScaDetectedPackages } from '../entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from '../entities/sca-vulnerability-detections.entity';
import { ScaLicenseOverride } from '../entities/sca-license-override.entity';
import { VulnerabilityDetectionHistory } from '../entities/vulnerability-detection-history.entity';
import { HistoryItem } from '../entities/history-item.entity';
import { ContainerDetectedImage } from '../entities/container-detected-image.entity';
import { ContainerDetectedPackage } from '../entities/container-detected-package.entity';
import { VulnerabilityDetectionsContainer } from '../entities/container_vulnerability_detections.entity';
import { VulnerabilityOsv } from '../entities/osv';
import { ADVISORY_MATCHER } from '../edition/ports/advisory-matcher.port';
import { DETECTION_ENRICHERS } from '../edition/ports/detection-enrichers.port';
import { ResultService } from '../modules/result/result.service';
import { CyberiskRecomputeEnqueuer } from '../modules/cyber-risk/cyberisk-recompute.enqueuer';
import { ReferenceBranchResolver } from '../modules/cyber-risk/reference-branch.resolver';
import { ProjectOrgResolver } from '../core/realtime/project-org-resolver.service';
import { IssueIntegrationService } from '../modules/vulnerability/issue-integration.service';
import { CvssCalculatorService } from '../modules/cvss/cvss-calculator.service';
import { CvssExplainerService } from '../modules/cvss/cvss-explainer.service';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from '../test-utils/typeorm-mock.util';

// The DEFAULT fixture is a row a scan actually saw — that is the production
// shape for sast and iac, where `vulnerability_detection_history` covers 100%
// of the rows. A bucket with no trail is the exception (cicd, secret) and every
// test of it overrides `lastScanId` to null EXPLICITLY, because an untrailed
// multi-member bucket is refused rather than ranked: a fixture that forgets the
// trail silently asserts nothing.
const row = (over: Record<string, unknown> = {}) => ({
  id: 'det-1',
  projectId: 'p1',
  branch: 'main',
  scannerType: 'semgrep',
  catalogVulnId: 'cat-1',
  path: 'src/a.ts',
  vulnerableStartLine: 9,
  vulnerableEndLine: 9,
  snippetJson: JSON.stringify([{ line: 9, content: 'eval(x);' }]),
  lastScanId: 'scan-seen',
  lastSeenAt: '2026-05-01T00:00:00Z',
  ...over,
});

/** A twin of `row()` sitting at `line`, i.e. the same occurrence bucket. */
const twin = (id: string, line: number, over: Record<string, unknown> = {}) =>
  row({
    id,
    vulnerableStartLine: line,
    vulnerableEndLine: line,
    snippetJson: JSON.stringify([{ line, content: 'eval(x);' }]),
    ...over,
  });

describe('lastCompleteGroupBoundary', () => {
  const g = (projectId: string, branch: string, path: string) => ({
    projectId,
    branch,
    path,
  });

  it('returns the full length when the last row ends a group', () => {
    const rows = [g('p1', 'main', 'a.ts'), g('p1', 'main', 'b.ts')];
    expect(lastCompleteGroupBoundary(rows, false)).toBe(2);
  });

  it('excludes a trailing partial group when more pages remain', () => {
    const rows = [
      g('p1', 'main', 'a.ts'),
      g('p1', 'main', 'b.ts'),
      g('p1', 'main', 'b.ts'),
    ];
    expect(lastCompleteGroupBoundary(rows, true)).toBe(1);
  });

  it('returns the full length on the last page even if the tail looks partial', () => {
    const rows = [
      g('p1', 'main', 'a.ts'),
      g('p1', 'main', 'b.ts'),
      g('p1', 'main', 'b.ts'),
    ];
    expect(lastCompleteGroupBoundary(rows, false)).toBe(3);
  });

  it('returns 0 when the whole page is one group and more pages remain', () => {
    const rows = [g('p1', 'main', 'a.ts'), g('p1', 'main', 'a.ts')];
    expect(lastCompleteGroupBoundary(rows, true)).toBe(0);
    // The caller MUST grow its page size rather than loop forever on 0 progress.
  });

  // The group key is length-prefixed for the same reason the digest is: a raw
  // `${projectId}${branch}${path}` concatenation lets a boundary shift, so two
  // DIFFERENT groups can spell one key. Merging them here makes the boundary
  // function believe the tail is one group, and it then cuts a page in a place
  // that restarts the occurrence counter mid-group.
  it('does not merge two groups whose raw concatenation is identical', () => {
    const rows = [g('p', '1', 'a.ts'), g('p1', '', 'a.ts')];
    // 'p'+'1'+'a.ts' === 'p1'+''+'a.ts', so an unframed key sees ONE group
    // spanning the whole page and returns 0 (forcing a pointless page growth).
    expect(lastCompleteGroupBoundary(rows, true)).toBe(1);
  });
});

describe('parsePageSize', () => {
  it('falls back when the variable is absent', () => {
    expect(parsePageSize(undefined, 2000)).toBe(2000);
    expect(parsePageSize('', 2000)).toBe(2000);
  });

  it('accepts a positive integer', () => {
    expect(parsePageSize('7', 2000)).toBe(7);
  });

  it.each(['0', '-5', '2.5', 'abc', 'Infinity', '1e3'])(
    'refuses %s rather than interpolating it into LIMIT',
    (raw) => {
      expect(() => parsePageSize(raw, 2000)).toThrow(
        /FINGERPRINT_BACKFILL_PAGE_SIZE/,
      );
    },
  );
});

describe('buildCodeFingerprintRows', () => {
  it('produces one fingerprint per detection', () => {
    const out = buildCodeFingerprintRows([row()]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('det-1');
    expect(out[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives two identical findings in one file DIFFERENT fingerprints', () => {
    const out = buildCodeFingerprintRows([twin('a', 10), twin('b', 400)]);
    expect(out[0].fingerprint).not.toBe(out[1].fingerprint);
  });

  it('assigns the occurrence index by ascending line, not by input order', () => {
    const desc = buildCodeFingerprintRows([
      twin('late', 400),
      twin('early', 10),
    ]);
    const asc = buildCodeFingerprintRows([
      twin('early', 10),
      twin('late', 400),
    ]);
    const byId = (rs: Array<{ id: string; fingerprint: string }>) =>
      Object.fromEntries(rs.map((r) => [r.id, r.fingerprint]));
    expect(byId(desc)).toEqual(byId(asc));
  });

  it('survives a malformed or missing snippet without throwing', () => {
    expect(() =>
      buildCodeFingerprintRows([row({ snippetJson: 'not json' })]),
    ).not.toThrow();
    expect(() =>
      buildCodeFingerprintRows([row({ snippetJson: null })]),
    ).not.toThrow();
  });

  it('is stable across two runs over the same input', () => {
    expect(buildCodeFingerprintRows([row()])).toEqual(
      buildCodeFingerprintRows([row()]),
    );
  });

  // The occurrence counter is scoped per (scan, scanner) in production — the
  // Redis allocator's key carries the scanner — so two scanners reporting the
  // same finding each get index 0. A bucket key that omits scannerType ranks the second one 1 and mints a digest no scan reproduces.
  it('ranks two scanners independently, exactly as the per-scanner allocator does', () => {
    const out = buildCodeFingerprintRows([
      row({ id: 'a', scannerType: 'semgrep' }),
      row({ id: 'b', scannerType: 'bearer' }),
    ]);
    const alone = (scannerType: string) =>
      buildCodeFingerprintRows([row({ scannerType })])[0].fingerprint;
    expect(out[0].fingerprint).toBe(alone('semgrep'));
    expect(out[1].fingerprint).toBe(alone('bearer'));
  });
});

/**
 * DEFECT 1 (Critical). A bucket in production is routinely PART stamped: a
 * post-deploy scan re-detects some twins and stamps them, while the ones it no
 * longer sees stay NULL. Ranking only the NULL half restarts the occurrence
 * counter at 0 and re-mints a digest the stamped half already holds.
 */
describe('buildCodeFingerprintRows — a partially stamped bucket', () => {
  const T10 = twin('T10', 10);
  const T400 = twin('T400', 400);

  it('ranks the whole bucket and writes only its unstamped rows', () => {
    const whole = buildCodeFingerprintRows([T10, T400]);
    expect(whole.map((a) => a.id)).toEqual(['T10', 'T400']);

    const partial = buildCodeFingerprintRows([
      { ...T10, fingerprint: whole[0].fingerprint },
      T400,
    ]);

    expect(partial.map((a) => a.id)).toEqual(['T400']);
    expect(partial[0].fingerprint).toBe(whole[1].fingerprint);
  });

  it('never re-mints the digest the stamped twin already holds', () => {
    const whole = buildCodeFingerprintRows([T10, T400]);
    const partial = buildCodeFingerprintRows([
      { ...T10, fingerprint: whole[0].fingerprint },
      T400,
    ]);
    expect(partial.map((a) => a.fingerprint)).not.toContain(
      whole[0].fingerprint,
    );
  });

  it('is a no-op on a fully stamped bucket', () => {
    const whole = buildCodeFingerprintRows([T10, T400]);
    expect(
      buildCodeFingerprintRows([
        { ...T10, fingerprint: whole[0].fingerprint },
        { ...T400, fingerprint: whole[1].fingerprint },
      ]),
    ).toEqual([]);
  });
});

/**
 * DEFECT 2 (Important). The Redis allocator counts per (scan, scanner), so a
 * scan ranks only the findings IT saw. A backfill that ranks every row in the
 * table — resolved rows included — hands a live row an index no scan will ever
 * reproduce.
 *
 * `vulnerability_detection_history` carries the sighting trail (scanId +
 * detectedAt) for the sast and iac families. When it is absent the population
 * is NOT derivable, and a row whose population is unknown is left NULL rather
 * than stamped with a guess.
 */
describe('buildCodeFingerprintRows — ranking population', () => {
  it('ranks every member when they all belong to one scan', () => {
    const out = buildCodeFingerprintRows([
      twin('A', 10, { lastScanId: 's2', lastSeenAt: '2026-05-01T00:00:00Z' }),
      twin('B', 400, { lastScanId: 's2', lastSeenAt: '2026-05-01T00:00:00Z' }),
    ]);
    const unrestricted = buildCodeFingerprintRows([
      twin('A', 10),
      twin('B', 400),
    ]);
    expect(out.map((a) => a.fingerprint)).toEqual(
      unrestricted.map((a) => a.fingerprint),
    );
  });

  it('ranks only the members the most recent scan saw', () => {
    // A was last seen by scan s1; B by the later scan s2. A live re-scan of
    // this bucket therefore ranks B ALONE, at index 0.
    const out = buildCodeFingerprintRows([
      twin('A', 10, { lastScanId: 's1', lastSeenAt: '2026-04-01T00:00:00Z' }),
      twin('B', 400, { lastScanId: 's2', lastSeenAt: '2026-05-01T00:00:00Z' }),
    ]);
    const alone = buildCodeFingerprintRows([
      twin('B', 400, { lastScanId: 's2', lastSeenAt: '2026-05-01T00:00:00Z' }),
    ]);
    expect(out.map((a) => a.id)).toEqual(['B']);
    expect(out[0].fingerprint).toBe(alone[0].fingerprint);
  });

  // The test above cannot see WHICH comparison picked s2: 'scan:s2' > 'scan:s1'
  // lexically as well as temporally, so the last-resort tie-break alone gives
  // the right answer there. Real scan ids are UUIDs, where lexical order is
  // uncorrelated with time — so the cohort must be chosen on `lastSeenAt`, and
  // this case is the one that proves it: the NEWER scan sorts FIRST lexically.
  it('picks the most recent scan by time, not by scan id order', () => {
    const older = {
      lastScanId: 'zzzz1111-old-scan',
      lastSeenAt: '2026-04-01T00:00:00Z',
    };
    const newer = {
      lastScanId: 'aaaa9999-new-scan',
      lastSeenAt: '2026-05-01T00:00:00Z',
    };
    const out = buildCodeFingerprintRows([
      twin('A', 10, older),
      twin('B', 400, newer),
    ]);
    const alone = buildCodeFingerprintRows([twin('B', 400, newer)]);
    expect(out.map((a) => a.id)).toEqual(['B']);
    expect(out[0].fingerprint).toBe(alone[0].fingerprint);
  });

  // `currentState` IS NOT SIGHTING EVIDENCE, and this is the case that proves
  // treating it as such steals an identity. `vulnerability_detections_secret`
  // has no auto-resolve-on-disappearance at all — `markResolved`'s union is
  // Sast|Iac|Cicd, and the only two writers of `resolved` on that table are
  // `rotateSecret` and `handleUpdateSecret`, both human decisions. So a
  // `resolved` secret row is one a person closed, NOT one a scan stopped
  // seeing: the last scan ranked it together with its twin.
  it('never hands a live twin the digest its resolved bucket-mate holds', () => {
    // What the scanner produced when it ranked both twins — the digest does not
    // depend on the trail, only on the occurrence index.
    const scanSaw = buildCodeFingerprintRows([twin('S1', 10), twin('S2', 20)]);
    // A user then rotated S1. Excluding it re-ranks S2 from 0 and writes S1's
    // exact digest onto S2: the digest does not hash the line number, so for a
    // family whose vulnerable region normalises to '' the two are byte-identical.
    const out = buildCodeFingerprintRows([
      twin('S1', 10, { lastScanId: null, currentState: 'resolved' }),
      twin('S2', 20, { lastScanId: null, currentState: 'to_verify' }),
    ]);
    expect(out.map((a) => a.fingerprint)).not.toContain(scanSaw[0].fingerprint);
  });

  it('refuses a multi-member bucket with no sighting trail rather than guessing', () => {
    // No history row for either member, so there is NO evidence of which rows
    // the last scan saw. A hole self-heals on the next scan; a wrong identity
    // does not — so both members stay NULL, whatever their currentState says.
    expect(
      buildCodeFingerprintRows([
        twin('gone', 10, { lastScanId: null, currentState: 'resolved' }),
        twin('live', 400, { lastScanId: null, currentState: 'to_verify' }),
      ]),
    ).toEqual([]);
    expect(
      buildCodeFingerprintRows([
        twin('A', 10, { lastScanId: null, currentState: 'resolved' }),
        twin('B', 400, { lastScanId: null, currentState: 'resolved' }),
      ]),
    ).toEqual([]);
  });

  it('still stamps a lone row with no sighting trail', () => {
    // A bucket of one is not a guess: any scan that saw the row ranked it 0,
    // and no other row of the bucket can shift that.
    const out = buildCodeFingerprintRows([
      twin('only', 10, { lastScanId: null, currentState: 'resolved' }),
    ]);
    expect(out.map((a) => a.id)).toEqual(['only']);
    expect(out[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a trailed cohort still ranks whole, even when one member is resolved', () => {
    // The trail says the last scan saw BOTH, so both are ranked — `resolved`
    // never removes a member from a population the evidence establishes.
    const seen = { lastScanId: 's9', lastSeenAt: '2026-05-01T00:00:00Z' };
    const out = buildCodeFingerprintRows([
      twin('A', 10, { ...seen, currentState: 'resolved' }),
      twin('B', 400, seen),
    ]);
    const unrestricted = buildCodeFingerprintRows([
      twin('A', 10, seen),
      twin('B', 400, seen),
    ]);
    expect(out.map((a) => a.fingerprint)).toEqual(
      unrestricted.map((a) => a.fingerprint),
    );
  });
});

/**
 * The second half of the Defect 1 fix. Ranking the whole bucket removes the
 * cause; this refuses the effect wherever it survives — a stored digest that is
 * itself mis-stamped, a hash collision, two rows the input cannot tell apart.
 * A refused row stays NULL. It never guesses.
 */
describe('refuseClaimedFingerprints', () => {
  const a = { id: 'r1', fingerprint: 'f1' };
  const b = { id: 'r2', fingerprint: 'f2' };

  it('writes an unclaimed digest', () => {
    const out = refuseClaimedFingerprints([a, b], new Map());
    expect(out.write).toEqual([a, b]);
    expect(out.refused).toEqual([]);
  });

  it('refuses a digest another row already holds', () => {
    const out = refuseClaimedFingerprints([a, b], new Map([['f1', 'other']]));
    expect(out.write).toEqual([b]);
    expect(out.refused).toEqual([a]);
  });

  it('keeps a digest the SAME row already holds, so a re-run is a no-op', () => {
    const out = refuseClaimedFingerprints([a], new Map([['f1', 'r1']]));
    expect(out.write).toEqual([a]);
    expect(out.refused).toEqual([]);
  });

  it('refuses BOTH rows when two assignments carry one digest', () => {
    const twinA = { id: 'r1', fingerprint: 'same' };
    const twinB = { id: 'r2', fingerprint: 'same' };
    const out = refuseClaimedFingerprints([twinA, twinB], new Map());
    expect(out.write).toEqual([]);
    expect(out.refused).toEqual([twinA, twinB]);
  });
});

/**
 * A miniature MySQL over an in-memory table, faithful in the four respects the
 * SQL layer's correctness rests on: it HONOURS a `d.fingerprint IS NULL`
 * predicate on the page query (the predicate whose absence is the Critical),
 * it honours the row-value cursor and the LIMIT, it answers the claim query
 * from the CURRENT contents of the table, and its UPDATE applies
 * `AND fingerprint IS NULL`.
 *
 * Without it the entire SQL half of this script — the half that shipped the
 * bug — is guarded by nothing but a manual run recorded in prose.
 */
/** Tuple separator for the fake's ORDER BY; NUL sorts before every other char. */
const SEP = '\u0000';

function fakeCodeTable(
  rows: Array<Record<string, unknown>>,
  history: Record<string, { scanId: string; detectedAt: string }> = {},
) {
  const state = rows.map((r) => ({ fingerprint: null, ...r }) as any);
  const sql: string[] = [];
  const ds = {
    query: async (q: string, params: any[] = []): Promise<any> => {
      sql.push(q);
      if (/SELECT DISTINCT/.test(q)) {
        return state.map((r) => ({
          projectId: r.projectId,
          branch: r.branch,
          scannerType: r.scannerType,
          path: r.path,
        }));
      }
      if (/COUNT\(\*\) n/.test(q)) return [{ n: 0 }];
      // Matched on the SHAPE of the sighting query, not on the table name: the
      // table name also appears inside a derived table if the trail is joined
      // into the page query, and dispatching on that would silently hand the
      // page query the history rows.
      if (/^\s*SELECT `\w+` AS detId/.test(q)) {
        return params
          .filter((id) => history[id])
          .map((id) => ({
            detId: id,
            stamp: `${history[id].detectedAt}|${history[id].scanId}`,
          }));
      }
      if (/^\s*SELECT id, fingerprint/.test(q)) {
        return state
          .filter((r) => r.fingerprint && params.includes(r.fingerprint))
          .map((r) => ({ id: r.id, fingerprint: r.fingerprint }));
      }
      if (/^\s*UPDATE/.test(q)) {
        // params = [id, fingerprint] * n, then [id] * n
        const half = (params.length / 3) * 2;
        let affected = 0;
        for (let i = 0; i < half; i += 2) {
          const target = state.find((r) => r.id === params[i]);
          if (target && target.fingerprint == null) {
            target.fingerprint = params[i + 1];
            affected++;
          }
        }
        return { affectedRows: affected };
      }
      // The page query.
      const limit = Number(/LIMIT (\d+)/.exec(q)?.[1] ?? 0);
      const onlyNull = /d\.fingerprint IS NULL/.test(q);
      const key = (r: any) => [r.projectId, r.branch ?? '', r.path, r.id];
      const after = (r: any) => {
        const a = key(r).join(SEP);
        const b = (params as string[]).join(SEP);
        return a > b;
      };
      return (
        state
          .filter((r) => (onlyNull ? r.fingerprint == null : true))
          .filter(after)
          .sort((a, b) => (key(a).join(SEP) < key(b).join(SEP) ? -1 : 1))
          .slice(0, limit)
          // The page SELECT projects NO sighting columns — the trail arrives
          // through the separate, id-scoped history query — so the fake must
          // not leak a fixture's own trail into the page.
          .map((r: any) => {
            const projected = { ...r };
            delete projected.lastScanId;
            delete projected.lastSeenAt;
            return projected;
          })
      );
    },
  };
  return { ds, state, sql };
}

/**
 * DEFECT 1, the SQL half. `buildCodeFingerprintRows` can only rank a whole
 * bucket if the SELECT hands it the whole bucket — and the predicate that broke
 * that is one line in a query no unit test reached. Restoring
 * `d.fingerprint IS NULL` to the page query left the previous suite 34/34
 * green; it does not any more.
 */
describe('backfillCodeTable — the page query reads the WHOLE bucket', () => {
  const T10 = twin('T10', 10);
  const T400 = twin('T400', 400);
  const seen = { scanId: 's1', detectedAt: '2026-05-01 00:00:00' };

  it('ranks a part-stamped bucket from the stored twin, not from 0', async () => {
    const whole = buildCodeFingerprintRows([T10, T400]);
    const { ds, state } = fakeCodeTable(
      [
        { ...T10, fingerprint: whole[0].fingerprint, vulnerabilityId: 'cat-1' },
        { ...T400, fingerprint: null, vulnerabilityId: 'cat-1' },
      ],
      { T10: seen, T400: seen },
    );

    const out = await backfillCodeTable(ds as any, 'sast', false, 2000);

    // With the predicate restored, the page holds T400 alone, it is ranked 0,
    // and the digest it is handed is the one T10 already holds — so the claim
    // query refuses it and NOTHING is written.
    expect(out.backfilled).toBe(1);
    expect(out.refusedDuplicate).toBe(0);
    expect(out.refusedPopulation).toBe(0);
    expect(state.find((r) => r.id === 'T400').fingerprint).toBe(
      whole[1].fingerprint,
    );
    expect(state.find((r) => r.id === 'T10').fingerprint).toBe(
      whole[0].fingerprint,
    );
  });

  it('refuses an untrailed multi-member bucket and names the rows it left NULL', async () => {
    const { ds, state } = fakeCodeTable([
      { ...twin('S1', 10), vulnerabilityId: 'cat-1' },
      { ...twin('S2', 20), vulnerabilityId: 'cat-1' },
    ]);

    const out = await backfillCodeTable(ds as any, 'secret', false, 2000);

    expect(out.backfilled).toBe(0);
    expect(out.refusedPopulation).toBe(2);
    // A population refusal is the counter an operator is EXPECTED to see on a
    // naturally part-stamped table, so it has to be inspectable — a bare count
    // gives them nothing to look at.
    expect(out.samples.join(' ')).toContain('S1');
    expect(out.samples.join(' ')).toContain('S2');
    expect(state.every((r) => r.fingerprint == null)).toBe(true);
  });
});

/**
 * `--dry-run` is the recommended pre-flight on a production database, so the numbers it prints have to mean the same thing as a real
 * run's. In a real run the previous chunk's UPDATE has landed, so the claim
 * query sees it; a dry run writes nothing, so it has to carry its own claims.
 */
describe('applyFingerprints — --dry-run', () => {
  const emptyDs = () => ({
    query: jest.fn(async (q: string) =>
      /^\s*SELECT/.test(q) ? [] : { affectedRows: 0 },
    ),
  });

  it('catches a duplicate that straddles two UPDATE chunks', async () => {
    // 501 assignments: chunk 1 is rows 0..499, chunk 2 is row 500. Rows 0 and
    // 500 carry one digest, so only a claim state that crosses the chunk
    // boundary can see the pair.
    const assignments = Array.from({ length: 501 }, (_, i) => ({
      id: `r${i}`,
      fingerprint: i === 500 ? 'dup' : i === 0 ? 'dup' : `f${i}`,
    }));
    const ds = emptyDs();

    const out = await applyFingerprints(
      ds as any,
      'vulnerability_detections_sast',
      assignments,
      true,
    );

    expect(out.refusedDuplicate).toBe(1);
    expect(out.written).toBe(500);
    expect(ds.query.mock.calls.every(([q]) => /^\s*SELECT/.test(q))).toBe(true);
  });
});

/**
 * The number that gates an IRREVERSIBLE unique index must not saturate. The
 * grouped query is capped at 50 so the samples stay readable; the COUNT is a
 * separate, uncapped query.
 */
describe('collisionReport', () => {
  it('counts every colliding group, not just the 50 it samples', async () => {
    const ds = {
      query: jest.fn(async (q: string) =>
        /^\s*SELECT COUNT\(\*\)/.test(q)
          ? [{ n: 5000 }]
          : Array.from({ length: 50 }, (_, i) => ({
              projectId: 'p1',
              branch: 'main',
              fingerprint: `f${i}`,
              n: 2,
            })),
      ),
    };

    const out = await collisionReport(
      ds as any,
      'vulnerability_detections_sast',
      true,
    );

    expect(out.collidingGroups).toBe(5000);
    expect(out.samples).toHaveLength(50);
  });
});

// A backfilled digest that the ingestion path does not reproduce is worse than
// no digest at all: every later scan of unchanged code logs a
// FINGERPRINT_MISMATCH against it. These are the only tests that PROVE the two
// agree rather than asserting it in a comment. Each drives the PRODUCTION call
// site — never a re-derivation of it — because a silent swap of two components
// still returns 64 hex chars and still reports zero collisions.
describe('parity with the ingestion path — code families', () => {
  const code = [{ line: 9, content: 'eval(x);' }];
  const ingest = async (occurrenceIndex: number) => {
    const { fingerprintForNewSastDetection } =
      await import('../modules/sast-iac/sast-iac.utils');
    return fingerprintForNewSastDetection(
      {
        path: 'src/a.ts',
        language: 'TypeScript',
        codeSnippet: {
          vulnerableStartLine: 9,
          vulnerableEndLine: 9,
          code,
        },
      } as never,
      { vulnerability: { id: 'cat-1' } } as never,
      'p1',
      'semgrep',
      'main',
      occurrenceIndex,
    );
  };

  it('reproduces the digest fingerprintForNewSastDetection stamps at index 0', async () => {
    // `code_snippet.code` is a JSON column holding `JSON.stringify(code)`, so
    // the driver hands the backfill a JSON string OF a JSON string.
    const [backfilled] = buildCodeFingerprintRows([
      row({
        language: 'TypeScript',
        snippetJson: JSON.stringify(JSON.stringify(code)),
      }),
    ]);
    expect(backfilled.fingerprint).toBe(await ingest(0));
  });

  // Index 0 is the one value that cannot detect a disagreement about how the
  // index itself is derived — which is exactly where defects 1 and 2 live.
  it('reproduces the digest at a NON-ZERO occurrence index', async () => {
    const snippetJson = JSON.stringify(JSON.stringify(code));
    const out = buildCodeFingerprintRows([
      row({ id: 'first', language: 'TypeScript', snippetJson }),
      row({
        id: 'second',
        language: 'TypeScript',
        snippetJson,
        // Same start line, same snippet, different end line: a genuinely
        // distinct row that neither the digest nor the bucket key separates,
        // so the occurrence counter is what keeps the two apart.
        vulnerableEndLine: 9,
      }),
    ]);
    expect(out).toHaveLength(2);
    const digests = out.map((a) => a.fingerprint);
    expect(digests).toContain(await ingest(0));
    expect(digests).toContain(await ingest(1));
  });
});

/**
 * DEFECT 4. `buildScaFingerprintRows` and `buildContainerFingerprintRows`
 * between them write more than half the corpus and had ZERO tests. A silent
 * swap of `packageName`/`packageVersion`, or reading the image's branch instead
 * of the detection row's, still returns 64 hex chars and still reports zero
 * collisions — the digest stays injective either way. Only a parity test
 * against the production call site pins the MAPPING.
 *
 * Both tests drive the real service method and read the fingerprint it puts on
 * the entity, rather than re-deriving the expected value from
 * `computeScaFingerprint` / `computeContainerFingerprint` here. A test that
 * calls the digest itself would agree with a swapped mapping.
 */
describe('parity with the ingestion path — sca', () => {
  let service: ScaService;
  let scaVulnRepo: MockType<any>;

  const pkg = {
    id: 'pkg-1',
    // DELIBERATELY NOT the projectId argument below. Production hashes
    // `pkg.projectId` and stores the detection with that same value, while the
    // backfill reads `d.projectId` — two expressions of one value. Give both
    // sides the same string and the test is blind to which one either reads.
    projectId: 'pkg-project',
    ecosystem: 'npm',
    packageName: 'lodash',
    packageVersion: '4.17.20',
    isDev: false,
    isTransitive: false,
    reachability: null,
    dependencyInfoAvailable: true,
  } as any;

  const affected = {
    severity: [],
    vulnerability: { id: 'GHSA-jf85-cpcp-j695', severities: [] },
  } as any;

  beforeEach(async () => {
    const scaDetectedRepo = createMockRepository();
    scaVulnRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScaService,
        {
          provide: getRepositoryToken(ScaDetectedPackages),
          useValue: scaDetectedRepo,
        },
        {
          provide: getRepositoryToken(ScaVulnerabilityDetections),
          useValue: scaVulnRepo,
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionHistory),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(HistoryItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ScaLicenseOverride),
          useValue: createMockRepository(),
        },
        {
          provide: ADVISORY_MATCHER,
          useValue: { findMatchingVulnerabilities: jest.fn() },
        },
        {
          provide: CvssCalculatorService,
          useValue: {
            computeCvss4Base: jest
              .fn()
              .mockReturnValue({ vector: 'CVSS:4.0/x', baseScore: 5.3 }),
          },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: DETECTION_ENRICHERS,
          useValue: [
            {
              name: 'EPSS',
              enrichDetections: jest.fn().mockResolvedValue(0),
            },
          ],
        },
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: jest.fn().mockResolvedValue({}),
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'normal', priorityScore: 10 }),
          },
        },
        {
          provide: IssueIntegrationService,
          useValue: {
            closeIssuesForVulnerabilities: jest
              .fn()
              .mockResolvedValue(undefined),
            createIssuesForScan: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: () => ({
              get: jest.fn().mockReturnValue(of({ parsedBranches: [] })),
            }),
          },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: {
            getService: () => ({
              updateScanState: jest.fn().mockReturnValue(of({})),
            }),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: getDataSourceToken(),
          useValue: { createQueryBuilder: jest.fn() },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ReferenceBranchResolver,
          useValue: {
            getScoringBranches: jest.fn().mockResolvedValue(['main']),
          },
        },
        {
          provide: ProjectOrgResolver,
          useValue: { resolveOrgId: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(ScaService);
    service.onModuleInit();
    scaVulnRepo.find!.mockResolvedValue([]);
    scaVulnRepo.create!.mockImplementation((e: any) => e);
    scaVulnRepo.save!.mockImplementation(async (e: any) => ({
      ...e,
      id: 'd1',
    }));
  });

  it('reproduces the digest batchHandleVulnerabilities stamps on a new detection', async () => {
    await (service as any).batchHandleVulnerabilities(
      [{ pkg, vulns: [affected] }],
      'p1',
      'scan-1',
      'ALL',
      'main',
      ['main'],
    );

    const ingested = scaVulnRepo.create!.mock.calls[0][0].fingerprint;
    expect(ingested).toMatch(/^[0-9a-f]{64}$/);
    // The stored `projectId` — what the backfill's `d.projectId` reads — is the
    // PACKAGE's, not the argument's. Both halves of the parity argument have to
    // hold: the digest hashes it AND the column carries it.
    expect(scaVulnRepo.create!.mock.calls[0][0].projectId).toBe('pkg-project');

    // The row shape is exactly what the backfill's SELECT projects:
    // d.projectId, d.branch, p.ecosystem, p.packageName, p.packageVersion and
    // d.vulnerabilityId AS osvId.
    const [backfilled] = buildScaFingerprintRows([
      {
        id: 'd1',
        projectId: 'pkg-project',
        branch: 'main',
        ecosystem: 'npm',
        packageName: 'lodash',
        packageVersion: '4.17.20',
        osvId: 'GHSA-jf85-cpcp-j695',
      },
    ]);
    expect(backfilled.fingerprint).toBe(ingested);
  });
});

describe('parity with the ingestion path — container', () => {
  let service: ContainerService;
  let detRepo: MockType<any>;

  // Both image fields DELIBERATELY disagree with the scan's. The digest must
  // come from the scan/detection row, never from `container_detected_images`:
  // one row is shared by two images for class='lang-pkgs', and `det.detectedImage`
  // is re-pointed at the latest scan on every re-detection, so hashing the image
  // would give one row two identities. With `image.branch === branch` the test
  // cannot tell the two sources apart.
  const image = {
    id: 'img-1',
    projectId: 'image-project',
    artifactName: 'registry/app:1.0.0',
    branch: 'feature/from-image',
  } as any;

  const pkg = {
    id: 'pkg-1',
    projectId: 'p1',
    packageName: 'openssl',
    packageVersion: '1.1.1k',
    target: 'registry/app:1.0.0 (debian 12.5)',
    class: 'os-pkgs',
    arch: 'x86_64',
  } as any;

  beforeEach(async () => {
    detRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContainerService,
        {
          provide: getRepositoryToken(ContainerDetectedImage),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(ContainerDetectedPackage),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityDetectionsContainer),
          useValue: detRepo,
        },
        {
          provide: getRepositoryToken(HistoryItem),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(VulnerabilityOsv),
          useValue: createMockRepository(),
        },
        {
          provide: ResultService,
          useValue: {
            addHistoryItem: jest.fn(),
            recalculatePriority: jest
              .fn()
              .mockResolvedValue({ priority: 'normal', priorityScore: 0.5 }),
            computeEnvironmentalForProject: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: CvssCalculatorService,
          useValue: {
            computeCvss4Base: jest
              .fn()
              .mockReturnValue({ vector: 'CVSS:4.0/x', baseScore: 8.1 }),
          },
        },
        {
          provide: CvssExplainerService,
          useValue: { buildExplanationForEntity: jest.fn() },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: Logger, useValue: createLoggerMock() },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(ContainerService);
    detRepo.save!.mockImplementation(async (x: any) => x);
    detRepo.findOne!.mockResolvedValue(null);
  });

  it('reproduces the digest upsertDetection stamps on a new detection', async () => {
    await (service as any).upsertDetection(
      'p1',
      image,
      pkg,
      { id: 'CVE-2021-1234' },
      {
        vulnerabilityId: 'CVE-2021-1234',
        severity: 'high',
        fixedVersion: '1.1.1l',
      },
      'main',
    );

    const ingested = detRepo.create!.mock.calls[0][0].fingerprint;
    expect(ingested).toMatch(/^[0-9a-f]{64}$/);
    // The columns the backfill's SELECT reads carry the scan's values, not the
    // image's — so parity is a claim about the same two strings on both sides.
    expect(detRepo.create!.mock.calls[0][0].projectId).toBe('p1');
    expect(detRepo.create!.mock.calls[0][0].branch).toBe('main');

    // The row shape is exactly what the backfill's SELECT projects: the branch
    // comes from the DETECTION row, never from `container_detected_images`.
    const [backfilled] = buildContainerFingerprintRows([
      {
        id: 'd1',
        projectId: 'p1',
        branch: 'main',
        packageName: 'openssl',
        packageVersion: '1.1.1k',
        target: 'registry/app:1.0.0 (debian 12.5)',
        packageClass: 'os-pkgs',
        arch: 'x86_64',
        vulnerabilityIdentifier: 'CVE-2021-1234',
      },
    ]);
    expect(backfilled.fingerprint).toBe(ingested);
  });
});
