/**
 * END-TO-END check for the drift merge: the REAL service, on REAL repositories,
 * against a REAL MySQL.
 *
 * WHY IT IS WRITTEN THIS WAY. `sast-iac.drift-merge.spec.ts` drives the real
 * service with mocked repositories, so it proves the DECISION (merge vs create)
 * and never touches SQL. A first version of THIS script was blind in the mirror
 * way: it hand-wrote the UPDATE the merge is supposed to perform and then checked
 * MySQL had stored it — trivially true, and green even if `createNewVulnerability`
 * wrote nothing at all.
 *
 * So this script calls the production method and then only READS rows back.
 * Everything asserted below is a consequence of the shipped code, never of a
 * write made here.
 *
 * NOT part of the jest suite on purpose: the suite must run without a database,
 * or it dies at collection in CI (a lesson learnt on the Python agent service).
 *
 * Usage, from analysis-reporting-service, LOCAL stack only:
 *   DB_HOST=127.0.0.1 DB_PORT=3308 DB_USERNAME=root DB_PASSWORD=password \
 *   DB_DATABASE=cybedefend_analysis_and_reporting \
 *   node -r ts-node/register -r tsconfig-paths/register src/scripts/e2e-drift-merge.ts
 *
 * Every row it writes is removed in a `finally`, including on failure.
 */
import 'reflect-metadata';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { requiredEnv } from './required-env';
import { computeCodeFingerprint } from '../modules/findings-export/fingerprint.util';
import { SastIacUtilsService } from '../modules/sast-iac/sast-iac.utils';
import { CicdVulnerabilityDetections } from '../entities/cicd-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from '../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../entities/iac-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../entities/secret-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from '../entities/vulnerability-detection-history.entity';
import { CodeSnippet } from '../entities/code-snippet.entity';
import { DataFlowItem } from '../entities/data-flow-item.entity';
import { CorrespondanceTable } from '../entities/vulnerability/correspondance-table.entity';

const PROJECT_ID = `e2e-drift-${randomUUID()}`;
const BRANCH = 'main';
const PATH = '.github/workflows/e2e-drift.yml';
const SCANNER = 'semgrep';

/**
 * The scanner RENUMBERS the snippet with the code: a finding reported at line 41
 * carries a snippet numbered 41. `normalizeSnippet` filters lines to the
 * vulnerable range and keeps only their CONTENT, so identical code at 38 and at
 * 41 normalises alike — that is what makes the digest survive a move, and the
 * premise of this whole feature. Holding the snippet at 38 while moving the
 * bounds to 41 is not a drift but an impossible input (the filter would yield an
 * EMPTY region); an earlier fixture did exactly that and every mocked case still
 * passed, because both sides computed the digest the same wrong way.
 */
const CODE = '  run: curl $URL | sh';
const snippetAt = (line: number) => [{ line, content: CODE }];

const ok: string[] = [];
const ko: string[] = [];
const check = (label: string, pass: boolean, detail = '') =>
  (pass ? ok : ko).push(pass ? label : `${label} — ${detail}`);

/** Collaborators that never touch the detection tables. */
const noop = (): any => new Proxy({}, { get: () => async () => undefined });

async function main(): Promise<void> {
  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3308),
    username: process.env.DB_USERNAME ?? 'root',
    password: requiredEnv('DB_PASSWORD'),
    database: process.env.DB_DATABASE ?? 'cybedefend_analysis_and_reporting',
    entities: [join(__dirname, '../**/*.entity.{ts,js}')],
  });
  await ds.initialize();

  try {
    const [cat] = await ds.query(`SELECT id FROM vulnerability LIMIT 1`);
    if (!cat?.id) throw new Error('no catalogue row to point at');

    const digestAt = (line: number) =>
      computeCodeFingerprint({
        projectId: PROJECT_ID,
        branch: BRANCH,
        scannerType: SCANNER,
        catalogVulnId: cat.id,
        path: PATH,
        snippetLines: snippetAt(line) as never,
        vulnerableStartLine: line,
        vulnerableEndLine: line,
        occurrenceIndex: 0,
      });

    check(
      'the digest survives the move: line 38 and line 41 agree',
      digestAt(38) === digestAt(41),
      `${digestAt(38).slice(0, 12)} vs ${digestAt(41).slice(0, 12)}`,
    );

    // The row as it stands BEFORE the scan: stamped at line 38, and RESOLVED so
    // the revival path is exercised too.
    const seededId = randomUUID();
    const cicdRepo = ds.getRepository(CicdVulnerabilityDetections);
    await cicdRepo.save(
      cicdRepo.create({
        id: seededId,
        projectId: PROJECT_ID,
        branch: BRANCH,
        scannerType: SCANNER,
        path: PATH,
        language: 'YAML',
        vulnerableStartLine: 38,
        vulnerableEndLine: 38,
        fingerprint: digestAt(38),
        currentState: 'resolved',
        currentSeverity: 'high',
        currentPriority: 50,
        stateManuallyModified: true,
        fileHash: 'h-old',
        vulnerability: { id: cat.id },
      } as any),
    );
    // Constructed DIRECTLY rather than through Nest: compiling a TestingModule
    // for this service hangs on its forwardRef cycle (SastIacService <->
    // ResultService <-> IssueIntegrationService). The order below MUST track the
    // constructor — verified against it, logger sits 13th, not 9th as a
    // reasonable guess would put it. The four @Optional() tail arguments are left
    // undefined on purpose: the drift path does not use them.
    const noopLogger = {
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as any;
    const svc = new SastIacUtilsService(
      ds.getRepository(CodeSnippet) as any,
      ds.getRepository(DataFlowItem) as any,
      ds.getRepository(CorrespondanceTable) as any,
      ds.getRepository(VulnerabilityDetectionHistory) as any,
      ds.getRepository(SastVulnerabilityDetections) as any,
      ds.getRepository(IacVulnerabilityDetections) as any,
      cicdRepo as any,
      ds.getRepository(SecretVulnerabilityDetections) as any,
      noop(),
      {
        computeEnvironmentalForProject: async () => undefined,
        recalculatePriority: async () => undefined,
        addHistoryItem: async () => undefined,
      } as any,
      noop(),
      { computeCvss4Base: () => ({ score: 5, vector: 'CVSS:4.0/' }) } as any,
      noopLogger,
      { encrypt: () => 'enc' } as any,
      noop(),
    );
    if (typeof (svc as any).createNewVulnerability !== 'function') {
      throw new Error(
        'constructor order drifted: createNewVulnerability missing',
      );
    }

    // The scan now reports the SAME finding three lines lower.
    await (svc as any).createNewVulnerability(
      {
        ruleId: 'rule-a',
        path: PATH,
        language: 'YAML',
        fileHash: 'h-new',
        codeSnippet: {
          // startLine/endLine are NOT optional on `code_snippet`. They are
          // supplied so that, when the merge is disabled to check this script
          // actually tests the shipped code, the creation path can COMPLETE and
          // the run reports a clean "2 rows" failure instead of an SQL crash.
          startLine: 41,
          endLine: 41,
          language: 'YAML',
          vulnerableStartLine: 41,
          vulnerableEndLine: 41,
          code: snippetAt(41),
        },
        dataFlow: [],
      },
      {
        ruleId: 'rule-a',
        scanner: SCANNER,
        vulnerabilityType: 'cicd',
        vulnerability: { id: cat.id, severity: 'high' },
      },
      randomUUID(),
      PROJECT_ID,
      SCANNER,
      BRANCH,
      0,
    );
    const rows = await ds.query(
      `SELECT id, vulnerableStartLine, currentState, state_manually_modified sm,
              fingerprint, fileHash
         FROM vulnerability_detections_cicd WHERE projectId = ?`,
      [PROJECT_ID],
    );

    check(
      'exactly ONE row exists — merged, not duplicated',
      rows.length === 1,
      `${rows.length} rows`,
    );
    const row = rows[0] ?? {};
    check('it is the ORIGINAL row', row.id === seededId, `id=${row.id}`);
    check(
      'the position was refreshed to the new line',
      Number(row.vulnerableStartLine) === 41,
      `line=${row.vulnerableStartLine}`,
    );
    check(
      'the fresh fileHash was taken',
      row.fileHash === 'h-new',
      `fileHash=${row.fileHash}`,
    );
    check(
      'a resolved finding was revived',
      row.currentState === 'to_verify',
      `state=${row.currentState}`,
    );
    check('the stale manual freeze was dropped', Number(row.sm) === 0);
    check(
      'the identity did not move',
      row.fingerprint === digestAt(41),
      String(row.fingerprint).slice(0, 12),
    );

    const dup = await ds.query(
      `SELECT COUNT(*) n FROM (
         SELECT 1 FROM vulnerability_detections_cicd
          WHERE projectId = ? AND fingerprint IS NOT NULL
          GROUP BY projectId, branch, fingerprint HAVING COUNT(*) > 1) g`,
      [PROJECT_ID],
    );
    check('no colliding group remains', Number(dup[0].n) === 0);

    // The lookup runs once per newly-created detection, so its plan is the whole
    // cost of the feature. EXPLAIN, not assumption.
    const [plan] = await ds.query(
      `EXPLAIN SELECT id FROM vulnerability_detections_cicd WHERE fingerprint = ?`,
      [digestAt(41)],
    );
    check(
      'the drift lookup rides IDX_..._fingerprint',
      String(plan?.key ?? '').includes('fingerprint'),
      `planner chose ${plan?.key}`,
    );

    // ---------------------------------------------------------------- edges
    // Everything below re-uses `create` through the same production method, on
    // fresh project ids so the scenarios cannot contaminate each other.

    const digestAtFor = (projectId: string, line: number) =>
      computeCodeFingerprint({
        projectId,
        branch: BRANCH,
        scannerType: SCANNER,
        catalogVulnId: cat.id,
        path: PATH,
        snippetLines: snippetAt(line) as never,
        vulnerableStartLine: line,
        vulnerableEndLine: line,
        occurrenceIndex: 0,
      });

    const runCreate = async (
      projectId: string,
      line: number,
      occurrenceIndex: number | null,
      branch = BRANCH,
      code = CODE,
      scanId = randomUUID(),
    ) =>
      (svc as any).createNewVulnerability(
        {
          ruleId: 'rule-a',
          path: PATH,
          language: 'YAML',
          fileHash: 'h-new',
          codeSnippet: {
            startLine: line,
            endLine: line,
            language: 'YAML',
            vulnerableStartLine: line,
            vulnerableEndLine: line,
            code: [{ line, content: code }],
          },
          dataFlow: [],
        },
        {
          ruleId: 'rule-a',
          scanner: SCANNER,
          vulnerabilityType: 'cicd',
          vulnerability: { id: cat.id, severity: 'high' },
        },
        scanId,
        projectId,
        SCANNER,
        branch,
        occurrenceIndex,
      );
    const countIn = async (projectId: string) =>
      Number(
        (
          await ds.query(
            `SELECT COUNT(*) n FROM vulnerability_detections_cicd WHERE projectId = ?`,
            [projectId],
          )
        )[0].n,
      );

    // THE DANGEROUS ONE. Two genuinely DISTINCT occurrences of one rule in one
    // file, arriving in the same scan. The allocator separates them with
    // occurrence indexes 0 and 1, so their digests differ and BOTH must be
    // written. If the drift lookup ever matched across them, a real vulnerability
    // would silently disappear — a worse outcome than the duplicate this whole
    // change removes.
    const twoP = `e2e-drift-two-${randomUUID()}`;
    await runCreate(twoP, 10, 0);
    await runCreate(twoP, 50, 1);
    check(
      'two distinct occurrences in one file both survive',
      (await countIn(twoP)) === 2,
      `${await countIn(twoP)} row(s)`,
    );

    // The honest counterpart: when the allocator hands the SAME index to two
    // distinct occurrences — the defect behind the 35 stored/computed mismatches
    // — their digests collide and the second MERGES into the first. One
    // occurrence is then lost. This is a real trade of one failure for another,
    // asserted here so nobody discovers it in production: before this change the
    // pair survived as two rows sharing one identity, now it is one row. The
    // allocator is what must be fixed; this records the consequence.
    const dupP = `e2e-drift-dup-${randomUUID()}`;
    const sharedScan = randomUUID();
    await runCreate(dupP, 10, 0, BRANCH, CODE, sharedScan);
    await runCreate(dupP, 50, 0, BRANCH, CODE, sharedScan);
    check(
      'a second occurrence seen by the SAME scan is never merged away',
      (await countIn(dupP)) === 2,
      `${await countIn(dupP)} row(s) — a live occurrence was lost`,
    );

    // Changed code is a DIFFERENT finding, not a move: the snippet is hashed, so
    // the digest differs and a new row is correct.
    const chgP = `e2e-drift-chg-${randomUUID()}`;
    await runCreate(chgP, 38, 0);
    await runCreate(chgP, 41, 0, BRANCH, '  run: wget $URL | sh');
    check(
      'a finding whose CODE changed is not merged away',
      (await countIn(chgP)) === 2,
      `${await countIn(chgP)} row(s)`,
    );

    // The digest hashes the branch, so a move on `develop` can never be absorbed
    // by the row on `main`. The lookup carries no branch predicate — this is what
    // proves the digest alone is enough.
    const brP = `e2e-drift-branch-${randomUUID()}`;
    await runCreate(brP, 38, 0, 'main');
    await runCreate(brP, 41, 0, 'develop');
    check(
      'a move on another branch is not merged into main',
      (await countIn(brP)) === 2,
      `${await countIn(brP)} row(s)`,
    );

    // --- persistence of the decisions, read back from MySQL ------------------
    // The unit tests assert these on a plain JS object, which proves nothing
    // about what the column kept. A dismissal that silently reverts on save is
    // exactly the kind of defect only a real database can expose.
    const seedRow = async (
      projectId: string,
      over: Record<string, any> = {},
    ) => {
      const id = randomUUID();
      await cicdRepo.save(
        cicdRepo.create({
          id,
          projectId,
          branch: BRANCH,
          scannerType: SCANNER,
          path: PATH,
          language: 'YAML',
          vulnerableStartLine: 38,
          vulnerableEndLine: 38,
          fingerprint: digestAtFor(projectId, 38),
          currentState: 'to_verify',
          currentSeverity: 'high',
          currentPriority: 50,
          fileHash: 'h-old',
          vulnerability: { id: cat.id },
          ...over,
        } as any),
      );
      return id;
    };
    const readRow = async (projectId: string) =>
      (
        await ds.query(
          `SELECT id, vulnerableStartLine, currentState, dismissal_reason,
                  first_detected_at, state_manually_modified sm
             FROM vulnerability_detections_cicd WHERE projectId = ?`,
          [projectId],
        )
      )[0];

    const digP = `e2e-drift-dismiss-${randomUUID()}`;
    const digId = await seedRow(digP, {
      currentState: 'ignored',
      dismissalReason: 'accepted risk, internal runner',
      stateManuallyModified: true,
      firstDetectedAt: new Date('2026-02-05T12:59:44Z'),
    });
    await runCreate(digP, 41, 0);
    const dismissed = await readRow(digP);
    check(
      'a DISMISSAL survives the merge in the database',
      dismissed?.currentState === 'ignored',
      `state=${dismissed?.currentState}`,
    );
    check(
      'its justification survives too',
      dismissed?.dismissal_reason === 'accepted risk, internal runner',
      `reason=${dismissed?.dismissal_reason}`,
    );
    check(
      'a dismissal is NOT unfrozen by the merge',
      Number(dismissed?.sm) === 1,
      `state_manually_modified=${dismissed?.sm}`,
    );
    check(
      'first_detected_at is not restated as new',
      new Date(dismissed?.first_detected_at).getTime() ===
        new Date('2026-02-05T12:59:44Z').getTime(),
      `${dismissed?.first_detected_at}`,
    );
    check(
      'and the position still moved',
      Number(dismissed?.vulnerableStartLine) === 41 && dismissed?.id === digId,
    );

    // --- the finding keeps drifting ------------------------------------------
    // 38 -> 41 -> 55 across three scans must stay ONE row, ending at 55. A merge
    // that only worked once would leave a trail of rows behind it.
    const chainP = `e2e-drift-chain-${randomUUID()}`;
    const chainId = await seedRow(chainP);
    await runCreate(chainP, 41, 0);
    await runCreate(chainP, 55, 0);
    const chained = await readRow(chainP);
    check(
      'successive moves keep ONE row',
      (await countIn(chainP)) === 1,
      `${await countIn(chainP)} row(s)`,
    );
    check(
      'it ends at the last position and keeps its identity',
      Number(chained?.vulnerableStartLine) === 55 && chained?.id === chainId,
      `line=${chained?.vulnerableStartLine}`,
    );

    // --- replaying the same scan ---------------------------------------------
    // A BullMQ retry re-submits an identical batch. It must be inert.
    const idemP = `e2e-drift-idem-${randomUUID()}`;
    await seedRow(idemP);
    const retryScan = randomUUID();
    await runCreate(idemP, 41, 0, BRANCH, CODE, retryScan);
    const afterFirst = await readRow(idemP);
    await runCreate(idemP, 41, 0, BRANCH, CODE, retryScan);
    check(
      'replaying a scan neither duplicates nor moves the row',
      (await countIn(idemP)) === 1 &&
        Number((await readRow(idemP))?.vulnerableStartLine) === 41 &&
        (await readRow(idemP))?.id === afterFirst?.id,
      `${await countIn(idemP)} row(s)`,
    );

    // --- a row the backfill never stamped ------------------------------------
    // NULL is what the whole pre-existing corpus carries. It cannot be found by
    // digest, so a move creates a second row: the honest, documented limit of
    // this fix — it protects rows that HAVE an identity, and the backfill is what
    // gives them one.
    const nullP = `e2e-drift-null-${randomUUID()}`;
    await seedRow(nullP, { fingerprint: null });
    await runCreate(nullP, 41, 0);
    check(
      'DOCUMENTED LIMIT: an unstamped row cannot be recognised, so a move creates a second',
      (await countIn(nullP)) === 2,
      `${await countIn(nullP)} row(s)`,
    );

    // --- losing a concurrent race -------------------------------------------
    // Reproduced without threads: a row already carrying the digest, and a scan
    // that has ALREADY seen it — so the drift guard refuses to merge and the
    // code proceeds to CREATE. Against UNIQUE (projectId, branch, fingerprint)
    // that insert is rejected. This is exactly what a worker losing the race
    // meets, and unguarded it aborts the whole scan batch.
    //
    // Runs on `sast`, which carries the index locally; `cicd` does not, which is
    // why every other scenario here is blind to the constraint.
    const raceP = `e2e-drift-race-${randomUUID()}`;
    const sastRepo = ds.getRepository(SastVulnerabilityDetections);
    const raceDigest = computeCodeFingerprint({
      projectId: raceP,
      branch: BRANCH,
      scannerType: SCANNER,
      catalogVulnId: cat.id,
      path: PATH,
      snippetLines: snippetAt(10) as never,
      vulnerableStartLine: 10,
      vulnerableEndLine: 10,
      occurrenceIndex: 0,
    });
    const raceScan = randomUUID();
    const raceSeed = randomUUID();
    await sastRepo.save(
      sastRepo.create({
        id: raceSeed,
        projectId: raceP,
        branch: BRANCH,
        scannerType: SCANNER,
        path: PATH,
        language: 'YAML',
        vulnerableStartLine: 10,
        vulnerableEndLine: 10,
        fingerprint: raceDigest,
        currentState: 'to_verify',
        currentSeverity: 'high',
        currentPriority: 50,
        vulnerability: { id: cat.id },
      } as any),
    );
    await ds.query(
      `INSERT INTO vulnerability_detection_history
         (id, scanId, sastVulnerabilityDetectionId, detectedAt)
       VALUES (?,?,?,NOW())`,
      [randomUUID(), raceScan, raceSeed],
    );

    let raceThrew: string | null = null;
    try {
      await (svc as any).createNewVulnerability(
        {
          ruleId: 'rule-a',
          path: PATH,
          language: 'YAML',
          fileHash: 'h-new',
          codeSnippet: {
            startLine: 10,
            endLine: 10,
            language: 'YAML',
            vulnerableStartLine: 10,
            vulnerableEndLine: 10,
            code: snippetAt(10),
          },
          dataFlow: [],
        },
        {
          ruleId: 'rule-a',
          scanner: SCANNER,
          vulnerabilityType: 'sast',
          vulnerability: { id: cat.id, severity: 'high' },
        },
        raceScan,
        raceP,
        SCANNER,
        BRANCH,
        0,
      );
    } catch (e: any) {
      raceThrew = e?.code || e?.driverError?.code || String(e?.message);
    }
    check(
      'losing a concurrent race does NOT abort the batch',
      raceThrew === null,
      `threw ${raceThrew}`,
    );
    const raceRows = Number(
      (
        await ds.query(
          `SELECT COUNT(*) n FROM vulnerability_detections_sast WHERE projectId = ?`,
          [raceP],
        )
      )[0].n,
    );
    check(
      'and leaves exactly the one row the winner wrote',
      raceRows === 1,
      `${raceRows} row(s)`,
    );
  } finally {
    // Children first. A detection created by the CREATION path (which is what
    // happens when the merge is disabled to check this script tests the shipped
    // code) owns a `code_snippet` row; without deleting it the DELETE below
    // fails on the foreign key and the run leaves rows behind — as an earlier
    // version of this cleanup did.
    const ids: Array<{ id: string }> = await ds.query(
      `SELECT id FROM vulnerability_detections_cicd WHERE projectId LIKE 'e2e-drift-%'`,
    );
    for (const { id } of ids) {
      await ds.query(
        `DELETE FROM vulnerability_detection_history
          WHERE cicdVulnerabilityDetectionId = ?`,
        [id],
      );
      await ds.query(
        `DELETE FROM code_snippet WHERE cicdVulnerabilityDetectionId = ?`,
        [id],
      );
    }
    await ds.query(
      `DELETE FROM vulnerability_detections_cicd WHERE projectId LIKE 'e2e-drift-%'`,
    );
    const sids: Array<{ id: string }> = await ds.query(
      `SELECT id FROM vulnerability_detections_sast WHERE projectId LIKE 'e2e-drift-%'`,
    );
    for (const { id } of sids) {
      await ds.query(
        `DELETE FROM vulnerability_detection_history
          WHERE sastVulnerabilityDetectionId = ?`,
        [id],
      );
      await ds.query(
        `DELETE FROM code_snippet WHERE sastVulnerabilityDetectionId = ?`,
        [id],
      );
    }
    await ds.query(
      `DELETE FROM vulnerability_detections_sast WHERE projectId LIKE 'e2e-drift-%'`,
    );
    await ds.destroy();
  }

  ok.forEach((l) => console.log(`  PASS  ${l}`));
  ko.forEach((l) => console.log(`  FAIL  ${l}`));
  console.log(`\n${ok.length} passed, ${ko.length} failed`);
  if (ko.length) process.exit(1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
