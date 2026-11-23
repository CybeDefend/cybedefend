import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, type QueryDeepPartialEntity } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { isUniqueViolation } from '@cybedefend/db-dialect';
import { RuleMetadata } from '@grpc/analysis-reporting/result';
import { Vulnerability } from '../../entities/vulnerability/vulnerability.entity';
import { CorrespondanceTable } from '../../entities/vulnerability/correspondance-table.entity';
import { References } from '../../entities/vulnerability/references.entity';
import {
  allocateLocalCodes,
  LOCAL_CODE_RANGE_START,
  parseVulnerabilityCode,
  vulnerabilityCodeType,
} from '../../core/vulnerability-code/vulnerability-code';
import {
  CatalogRule,
  catalogRuleIdOf,
  SastIacUtilsService,
} from '../sast-iac/sast-iac.utils';
import { ScanQueueService } from '../scan-queue/scan-queue.service';

/**
 * The import types: the category an import scan carries
 * (`CreateScanRequest.import_type` → `ImportResultsRequest.vulnerability_type`). The catalogue fallback writes it on the rows it creates.
 */
export type ImportCategory =
  | 'sast'
  | 'iac'
  | 'secret'
  | 'cicd'
  | 'sca'
  | 'container';

/**
 * The catalogue key of a rule an organisation imported: a hash of the
 * organisation and the full rule id, without a dot, since the catalogue is
 * keyed on the last dotted segment of a rule id.
 */
export function importedRuleKey(
  organizationId: string,
  ruleId: string,
): string {
  const digest = createHash('sha256')
    .update(`${organizationId}\u0000${ruleId}`)
    .digest('hex');
  return `imported-${digest.slice(0, 40)}`;
}

/** A rule of the shipped catalogue: a row with a code below the local range. */
function isShippedCatalogueRule(rule: CatalogRule | undefined): boolean {
  const parsed = rule?.code ? parseVulnerabilityCode(rule.code) : null;
  return parsed !== null && parsed.number < LOCAL_CODE_RANGE_START;
}

/**
 * Catalogue fallback for imported rules:
 * a SARIF rule with no enabled correspondence for (tool, last dotted rule id)
 * gets a local catalogue row — `CD-<TYPE>-90001…` from the local code range —
 * one correspondence and one documentation reference, so `processVulnerability`
 * resolves it like any catalogue rule.
 *
 * Concurrency: one detection creation lock per code TYPE (the code space is
 * per type), taken around a re-check plus one transaction that writes the
 * `vulnerability`, `correspondance_table` and `references` rows. A unique
 * violation on either unique index rolls the whole transaction back and runs
 * the re-check and the write once more in a NEW transaction: no
 * statement ever follows the failed one in the same transaction, so
 * PostgreSQL's aborted-transaction state is never reached and no savepoint is
 * used. Without the lock (null token or a Redis error) the write proceeds
 * after one WARN.
 *
 * Portable on both engines: query builder only, `isUniqueViolation`
 * from `libs/db-dialect`; never a MySQL error code in the code.
 */
@Injectable()
export class CatalogueFallbackService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sastIacUtils: SastIacUtilsService,
    private readonly scanQueue: ScanQueueService,
    private readonly logger: Logger,
  ) {}

  /**
   * The catalogue rule id each imported rule is ingested under, the rows it
   * needs created first.
   *
   * A rule of the shipped catalogue (a row with a registry code) keeps its
   * own id: its wording is public. Any other rule is the importing
   * organisation's own: it gets a key built from that organisation and the
   * FULL rule id, so its title and description never reach another
   * organisation, and two rules sharing a last segment (`a.sqli`, `b.sqli`)
   * stay two rules. A row an earlier import created under a last segment
   * is never reused for the same reason.
   *
   * @returns raw rule id → the rule id the findings must carry.
   */
  async catalogueRuleIds(
    toolName: string,
    category: ImportCategory,
    rules: RuleMetadata[],
    organizationId: string,
  ): Promise<Map<string, string>> {
    const byRawId = new Map<string, RuleMetadata>();
    for (const rule of rules) {
      if (rule.ruleId && !byRawId.has(rule.ruleId)) {
        byRawId.set(rule.ruleId, rule);
      }
    }
    const out = new Map<string, string>();
    if (byRawId.size === 0) return out;

    const shipped = await this.sastIacUtils.resolveCatalogRules(
      [...byRawId.keys()],
      toolName,
    );
    const owned: RuleMetadata[] = [];
    for (const [rawId, rule] of byRawId) {
      if (isShippedCatalogueRule(shipped.get(catalogRuleIdOf(rawId)))) {
        out.set(rawId, rawId);
        continue;
      }
      const key = importedRuleKey(organizationId, rawId);
      out.set(rawId, key);
      owned.push({ ...rule, ruleId: key });
    }
    if (owned.length > 0) {
      await this.ensureRules(toolName, category, owned);
    }
    return out;
  }

  /**
   * Ensures one enabled correspondence (scanner = `toolName`,
   * ruleId = `catalogRuleIdOf(m.ruleId)`) per metadata.
   *
   * @returns how many catalogue rules it created (0 when every rule was
   *   already known, including after a retry).
   */
  async ensureRules(
    toolName: string,
    category: ImportCategory,
    rules: RuleMetadata[],
  ): Promise<number> {
    // 1. Deduplicate by the last dotted segment, the key the correspondance
    //    table and processVulnerability use.
    const byRuleId = new Map<string, RuleMetadata>();
    for (const rule of rules) {
      const ruleId = catalogRuleIdOf(rule.ruleId);
      if (!ruleId || byRuleId.has(ruleId)) continue;
      byRuleId.set(ruleId, rule);
    }
    const ids = [...byRuleId.keys()];
    if (ids.length === 0) return 0;

    // 2. Nothing missing → no lock, no write.
    const known = await this.sastIacUtils.resolveCatalogRules(ids, toolName);
    if (ids.every((id) => known.has(id))) return 0;

    // 3. One lock per code type, because the code space is per type.
    const codeType = vulnerabilityCodeType(category);
    const lockKey = `catalogue-fallback:${codeType}`;
    let token: string | null = null;
    try {
      token = await this.scanQueue.acquireDetectionCreationLock(lockKey);
    } catch {
      token = null;
    }
    if (!token) {
      this.logger.warn(
        `CATALOGUE_FALLBACK_LOCK_SKIPPED tool=${toolName} type=${codeType}`,
      );
    }

    try {
      for (let attempt = 0; ; attempt += 1) {
        // 4. Re-check under the lock.
        const knownUnderLock = await this.sastIacUtils.resolveCatalogRules(
          ids,
          toolName,
        );
        const missing = ids.filter((id) => !knownUnderLock.has(id));
        if (missing.length === 0) return 0;

        // 5. Write in one transaction.
        try {
          return await this.writeMissingRules(
            toolName,
            category,
            codeType,
            missing,
            byRuleId,
          );
        } catch (e) {
          // 6. A unique violation: the transaction rolled back whole; steps 4
          //    and 5 run once more, step 5 in a new transaction. Any other
          //    error rethrows at once.
          if (attempt === 0 && isUniqueViolation(e)) continue;
          throw e;
        }
      }
    } finally {
      if (token) {
        await this.scanQueue.releaseDetectionCreationLock(lockKey, token);
      }
    }
  }

  /**
   * Steps 4–5's write: reads the existing local codes of the type, allocates
   * the new ones and inserts the `vulnerability`, `correspondance_table` and
   * `references` rows in one transaction. All inserts go through the query
   * builder with `updateEntity(false)` and ids set by the caller.
   */
  private async writeMissingRules(
    toolName: string,
    category: ImportCategory,
    codeType: string,
    missing: string[],
    byRuleId: Map<string, RuleMetadata>,
  ): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      // A plain LIKE on purpose: codes are upper-case and the prefix match
      // must stay case-sensitive on PostgreSQL (never ilike()).
      const rawCodes = (await manager
        .createQueryBuilder(Vulnerability, 'v')
        .select('v.code', 'code')
        .where('v.code LIKE :prefix', { prefix: `CD-${codeType}-%` })
        .getRawMany()) as Array<{ code: string | null }>;
      const existingCodes = rawCodes
        .map((row) => row.code)
        .filter((code): code is string => !!code);

      const rows = missing.map((ruleId) => ({
        ruleId,
        meta: byRuleId.get(ruleId) as RuleMetadata,
        id: randomUUID(),
      }));
      const codes = allocateLocalCodes(
        rows.map((row) => ({ id: row.id, vulnerabilityType: category })),
        existingCodes,
      );

      const vulnerabilityRows = rows.map(
        (row) =>
          ({
            id: row.id,
            name: row.meta.name,
            shortDescription: row.meta.shortDescription,
            description:
              row.meta.fullDescription ||
              row.meta.shortDescription ||
              row.meta.name,
            howToPrevent: row.meta.helpMarkdown,
            cwe: row.meta.cwe.length > 0 ? row.meta.cwe : null,
            // The OWASP labels of the imported rule; they hold no comma,
            // so the simple-array column stores them as they are.
            owaspTop10:
              row.meta.owaspTop10.length > 0 ? row.meta.owaspTop10 : null,
            severity: row.meta.severity,
            language: 'generic',
            vulnerabilityType: category,
            code: codes.get(row.id) as string,
            cvss3: null,
            codeExamples: null,
            sourceMetadata: null,
          }) as unknown as QueryDeepPartialEntity<Vulnerability>,
      );
      await manager
        .createQueryBuilder()
        .insert()
        .into(Vulnerability)
        .values(vulnerabilityRows)
        .updateEntity(false)
        .execute();

      const correspondanceRows = rows.map(
        (row) =>
          ({
            id: randomUUID(),
            scanner: toolName,
            ruleId: row.ruleId,
            vulnerabilityType: category,
            enabled: true,
            vulnerability: { id: row.id },
          }) as unknown as QueryDeepPartialEntity<CorrespondanceTable>,
      );
      await manager
        .createQueryBuilder()
        .insert()
        .into(CorrespondanceTable)
        .values(correspondanceRows)
        .updateEntity(false)
        .execute();

      const referenceRows = rows
        .filter((row) => row.meta.helpUri)
        .map(
          (row) =>
            ({
              id: randomUUID(),
              url: row.meta.helpUri,
              name: 'Rule documentation',
              vulnerability: { id: row.id },
            }) as unknown as QueryDeepPartialEntity<References>,
        );
      if (referenceRows.length > 0) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(References)
          .values(referenceRows)
          .updateEntity(false)
          .execute();
      }

      return rows.length;
    });
  }
}
