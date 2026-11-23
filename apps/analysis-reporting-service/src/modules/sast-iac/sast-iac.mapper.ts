// src/mappers/sast.mapper.ts

import { Vulnerability } from 'src/entities/vulnerability/vulnerability.entity';
import { CodeSnippet } from 'src/entities/code-snippet.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { DataFlowItem as EntityDataFlowItem } from 'src/entities/data-flow-item.entity';
import {
  DataFlowItem as ProtoDataFlowItem,
  VulnerabilitySast,
} from 'src/core/grpc/analysis-reporting/result'; // L'import de votre proto/interface

import {
  VulnerabilityMetadata,
  CodeLine,
  CodeSnippetDto,
  VulnerabilitySastIacResponse,
  VulnerabilityIac,
  VulnerabilityCicd,
  VulnerabilitySecret,
} from '@grpc/analysis-reporting/result';

import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { CvssExplainerService } from 'src/modules/cvss/cvss-explainer.service';
import { resolveEffectiveSeverity } from 'src/modules/cvss/severity-from-cvss';

function resolveScoringSource(e: {
  scoringSource?: 'static' | 'agent' | null;
  exploitabilitySource?: string | null;
}): 'static' | 'agent' {
  return e.scoringSource === 'agent' || e.exploitabilitySource === 'agent'
    ? 'agent'
    : (e.scoringSource ?? 'static');
}

// Agent verdict is stale if produced by the agent before the most
// recent security-context update. Manual overrides and static (code-based)
// scoring never go stale because they don't depend on the context.
// Also used by the grouped occurrences so both views agree.
export function computeExploitabilityStale(
  e: {
    exploitabilitySource?: string | null;
    exploitabilityUpdatedAt?: Date | null;
  },
  securityContextUpdatedAt?: Date | null,
): boolean | undefined {
  if (!securityContextUpdatedAt) return undefined;
  if (e.exploitabilitySource !== 'agent') return false;
  if (!e.exploitabilityUpdatedAt) return false;
  return (
    securityContextUpdatedAt.getTime() > e.exploitabilityUpdatedAt.getTime()
  );
}

/**
 * Maps the Vulnerability entity to the metadata ts-proto expects.
 */
export function mapVulnerabilityEntityToMetadata(
  e: Vulnerability,
): VulnerabilityMetadata {
  return {
    id: e.id,
    cwe: e.cwe ?? [],
    name: e.name,
    shortDescription: e.shortDescription,
    description: e.description,
    howToPrevent: e.howToPrevent,
    owaspTop10: e.owaspTop10 ? e.owaspTop10.map((item) => item.trim()) : [],
    severity: e.severity,
    language: e.language,
    vulnerabilityType: e.vulnerabilityType,
    // ts-proto also generates an identical cweArray field
    cweArray: e.cwe ?? [],
    references:
      e.references?.map((ref) => ({
        id: ref.id,
        url: ref.url,
        name: ref.name ?? '',
      })) ?? [],
    cvss3: e.cvss3 ?? undefined,
    codeExamples: e.codeExamples ?? [],
    sourceMetadata: e.sourceMetadata ?? undefined,
    code: e.code,
  };
}

/**
 * List-mode counterpart of {@link mapVulnerabilityEntityToMetadata}.
 *
 * Blanks out the long-form fields the dashboard list table does not render:
 * `description`, `howToPrevent`, `references`, `codeExamples`, `sourceMetadata`.
 * These fields are the bulk of the list response size on projects with many
 * critical SAST findings — the embedded code examples especially can hit
 * 100 KB+ per detection. The detail endpoint
 * (`mapVulnerabilityEntityToMetadata`) still returns the full payload.
 */
export function mapVulnerabilityEntityToListMetadata(
  e: Vulnerability,
): VulnerabilityMetadata {
  return {
    id: e.id,
    cwe: e.cwe ?? [],
    name: e.name,
    shortDescription: e.shortDescription,
    description: '',
    howToPrevent: '',
    owaspTop10: e.owaspTop10 ? e.owaspTop10.map((item) => item.trim()) : [],
    severity: e.severity,
    language: e.language,
    vulnerabilityType: e.vulnerabilityType,
    cweArray: e.cwe ?? [],
    references: [],
    cvss3: e.cvss3 ?? undefined,
    codeExamples: [],
    sourceMetadata: undefined,
    code: e.code,
  };
}

/**
 * Grouped-view counterpart of {@link mapVulnerabilityEntityToMetadata}
 * , one per rule of the SAST / IaC / CICD / Secret grouped
 * views. Drops `codeExamples` (up to 100 KB per rule, read only by the issue
 * detail page, which has its own route) and `sourceMetadata`. Unlike
 * {@link mapVulnerabilityEntityToListMetadata} it keeps `description`,
 * `howToPrevent` and `references`: the public CLI writes the grouped
 * `vulnerability` object verbatim into its JSON output (`results --grouped`).
 */
export function mapVulnerabilityEntityToGroupedMetadata(
  e: Vulnerability,
): VulnerabilityMetadata {
  return {
    ...mapVulnerabilityEntityToMetadata(e),
    codeExamples: [],
    sourceMetadata: undefined,
  };
}

/**
 * Maps the CodeSnippet entity to CodeSnippetDto (ts-proto).
 */
export function mapCodeSnippetEntityToInterface(
  e: CodeSnippet,
): CodeSnippetDto {
  const raw: { line: number; content: string }[] =
    typeof e.code === 'string' ? JSON.parse(e.code) : e.code;

  const code: CodeLine[] = raw.map((line) => ({
    line: line.line,
    content: line.content,
  }));

  return {
    id: e.id,
    vulnerableStartLine: e.vulnerableStartLine,
    vulnerableEndLine: e.vulnerableEndLine,
    startLine: e.startLine,
    endLine: e.endLine,
    code,
    language: e.language,
    fixAnalysis: e.fixAnalysis ?? '',
    fixAnalysisDescription: e.fixAnalysisDescription ?? '',
  };
}

/**
 * Maps the SastVulnerabilityDetections entity to VulnerabilitySastIacResponse (base).
 * No historyItems (undefined is returned); only the snippets are mapped.
 */
export function mapSastDetectionEntityToInterface(
  e: SastVulnerabilityDetections,
  explainer?: CvssExplainerService,
  securityContextUpdatedAt?: Date | null,
): VulnerabilitySastIacResponse {
  // Check if the AI agent has analyzed this vulnerability (userId = 'system')
  const hasCybeAnalysis = Array.isArray((e as any).historyItems)
    ? (e as any).historyItems.some((h: any) => h.userId === 'system')
    : false;

  // Check if vulnerability has autofix records
  const hasCybeAutofix = Array.isArray((e as any).autofixRecords)
    ? (e as any).autofixRecords.length > 0
    : false;

  return {
    id: e.id,
    projectId: e.projectId,
    createdAt: e.createdAt ? e.createdAt.toISOString() : '',
    updateAt: e.updateAt ? e.updateAt.toISOString() : '',
    timeToFix: e.timeToFix ?? '',
    currentState: e.currentState,
    currentSeverity: resolveEffectiveSeverity(e) ?? '',
    currentPriority: e.currentPriority,
    contextualExplanation: e.contextualExplanation ?? '',
    language: e.language,
    path: e.path,
    vulnerableStartLine: e.vulnerableStartLine,
    vulnerableEndLine: e.vulnerableEndLine,
    vulnerability: e.vulnerability
      ? mapVulnerabilityEntityToMetadata(e.vulnerability)
      : undefined,
    historyItems: undefined, // no history here
    codeSnippets: e.codeSnippets?.map(mapCodeSnippetEntityToInterface) ?? [],
    vulnerabilityType: 'sast',
    scannerRuleId: e.scannerRuleId || undefined,
    hasCybeAnalysis,
    hasCybeAutofix,
    autofixRecords: (e as any).autofixRecords
      ? (e as any).autofixRecords.map((r: any) => ({
          id: r.id,
          branch: r.branch,
          prUrl: r.prUrl || '',
          status: r.status,
          reason: r.reason || '',
          commitMessage: r.commitMessage,
          prTitle: r.prTitle,
          prBody: r.prBody,
          diff: r.diff || '',
          createdAt: r.createdAt?.toISOString() || '',
          updatedAt: r.updatedAt?.toISOString() || '',
        }))
      : [],
    branch: e.branch || undefined,
    scoringSource: resolveScoringSource(e),
    cvss4Vector: e.cvss4Vector ?? undefined,
    cvss4BaseScore: e.cvss4BaseScore ?? undefined,
    cvss4EnvironmentalScore: e.cvss4EnvironmentalScore ?? undefined,
    cvss4EnvironmentalVector: e.cvss4EnvironmentalVector ?? undefined,
    epssScore: e.epssScore ?? undefined,
    epssPercentile: e.epssPercentile ?? undefined,
    epssRefreshedAt: e.epssRefreshedAt?.toISOString() ?? undefined,
    exploitabilityScore: e.exploitabilityScore ?? undefined,
    exploitabilityVerdict: e.exploitabilityVerdict ?? undefined,
    exploitabilityReason: e.exploitabilityReason ?? undefined,
    exploitabilityScoreReason: e.exploitabilityScoreReason ?? undefined,
    exploitabilitySource: e.exploitabilitySource ?? undefined,
    exploitabilityUpdatedAt:
      e.exploitabilityUpdatedAt?.toISOString() ?? undefined,
    priorityScore: e.priorityScore ?? undefined,
    cvssExplanation: explainer?.buildExplanationForEntity(e),
    exploitabilityStale: computeExploitabilityStale(
      e,
      securityContextUpdatedAt,
    ),
    securityContextUpdatedAt:
      securityContextUpdatedAt?.toISOString() ?? undefined,
  };
}

export function mapSastDetectionToProto(
  e: SastVulnerabilityDetections,
  explainer?: CvssExplainerService,
  securityContextUpdatedAt?: Date | null,
): VulnerabilitySast {
  const mappedDataFlowItems = (e.dataFlowItems || []).map(
    (item: EntityDataFlowItem) => {
      const codeAsArray: ProtoDataFlowItem['code'] =
        typeof item.code === 'string'
          ? JSON.parse(item.code)
          : (item.code ?? []);

      const protoItem: ProtoDataFlowItem = {
        nameHighlight: item.nameHighlight,
        line: item.line,
        language: item.language,
        type: item.type,
        order: item.order,
        path: e.path,
        code: codeAsArray,
      };

      return protoItem;
    },
  );

  return {
    base: mapSastDetectionEntityToInterface(
      e,
      explainer,
      securityContextUpdatedAt,
    ),
    dataFlowItems: mappedDataFlowItems,
  };
}

export function mapIacDetectionEntityToInterface(
  e: IacVulnerabilityDetections,
  explainer?: CvssExplainerService,
  securityContextUpdatedAt?: Date | null,
): VulnerabilitySastIacResponse {
  // Check if the AI agent has analyzed this vulnerability (userId = 'system')
  const hasCybeAnalysis = Array.isArray((e as any).historyItems)
    ? (e as any).historyItems.some((h: any) => h.userId === 'system')
    : false;

  // Check if vulnerability has autofix records
  const hasCybeAutofix = Array.isArray((e as any).autofixRecords)
    ? (e as any).autofixRecords.length > 0
    : false;

  return {
    id: e.id,
    projectId: e.projectId,
    createdAt: e.createdAt ? e.createdAt.toISOString() : '',
    updateAt: e.updateAt ? e.updateAt.toISOString() : '',
    timeToFix: e.timeToFix ?? '',
    currentState: e.currentState,
    currentSeverity: resolveEffectiveSeverity(e) ?? '',
    currentPriority: e.currentPriority,
    contextualExplanation: e.contextualExplanation ?? '',
    language: e.language,
    path: e.path,
    vulnerableStartLine: e.vulnerableStartLine,
    vulnerableEndLine: e.vulnerableEndLine,
    vulnerability: e.vulnerability
      ? mapVulnerabilityEntityToMetadata(e.vulnerability)
      : undefined,
    historyItems: undefined, // no history here
    codeSnippets: e.codeSnippets?.map(mapCodeSnippetEntityToInterface) ?? [],
    vulnerabilityType: 'iac',
    scannerRuleId: e.scannerRuleId || undefined,
    hasCybeAnalysis,
    hasCybeAutofix,
    autofixRecords: (e as any).autofixRecords
      ? (e as any).autofixRecords.map((r: any) => ({
          id: r.id,
          branch: r.branch,
          prUrl: r.prUrl || '',
          status: r.status,
          reason: r.reason || '',
          commitMessage: r.commitMessage,
          prTitle: r.prTitle,
          prBody: r.prBody,
          diff: r.diff || '',
          createdAt: r.createdAt?.toISOString() || '',
          updatedAt: r.updatedAt?.toISOString() || '',
        }))
      : [],
    branch: e.branch || undefined,
    scoringSource: resolveScoringSource(e),
    cvss4Vector: e.cvss4Vector ?? undefined,
    cvss4BaseScore: e.cvss4BaseScore ?? undefined,
    cvss4EnvironmentalScore: e.cvss4EnvironmentalScore ?? undefined,
    cvss4EnvironmentalVector: e.cvss4EnvironmentalVector ?? undefined,
    epssScore: e.epssScore ?? undefined,
    epssPercentile: e.epssPercentile ?? undefined,
    epssRefreshedAt: e.epssRefreshedAt?.toISOString() ?? undefined,
    exploitabilityScore: e.exploitabilityScore ?? undefined,
    exploitabilityVerdict: e.exploitabilityVerdict ?? undefined,
    exploitabilityReason: e.exploitabilityReason ?? undefined,
    exploitabilityScoreReason: e.exploitabilityScoreReason ?? undefined,
    exploitabilitySource: e.exploitabilitySource ?? undefined,
    exploitabilityUpdatedAt:
      e.exploitabilityUpdatedAt?.toISOString() ?? undefined,
    priorityScore: e.priorityScore ?? undefined,
    cvssExplanation: explainer?.buildExplanationForEntity(e),
    exploitabilityStale: computeExploitabilityStale(
      e,
      securityContextUpdatedAt,
    ),
    securityContextUpdatedAt:
      securityContextUpdatedAt?.toISOString() ?? undefined,
  };
}

/**
 * Final ts-proto wrapper: only `base` is returned for IaC.
 */
export function mapIacDetectionToProto(
  e: IacVulnerabilityDetections,
  explainer?: CvssExplainerService,
  securityContextUpdatedAt?: Date | null,
): VulnerabilityIac {
  return {
    base: mapIacDetectionEntityToInterface(
      e,
      explainer,
      securityContextUpdatedAt,
    ),
  };
}

// -------------------------------------------------------------------
// CICD Mapping Functions
// -------------------------------------------------------------------

export function mapCicdDetectionEntityToInterface(
  e: CicdVulnerabilityDetections,
  explainer?: CvssExplainerService,
  securityContextUpdatedAt?: Date | null,
): VulnerabilitySastIacResponse {
  // Check if the AI agent has analyzed this vulnerability (userId = 'system')
  const hasCybeAnalysis = Array.isArray((e as any).historyItems)
    ? (e as any).historyItems.some((h: any) => h.userId === 'system')
    : false;

  // Check if vulnerability has autofix records
  const hasCybeAutofix = Array.isArray((e as any).autofixRecords)
    ? (e as any).autofixRecords.length > 0
    : false;

  return {
    id: e.id,
    projectId: e.projectId,
    createdAt: e.createdAt ? e.createdAt.toISOString() : '',
    updateAt: e.updateAt ? e.updateAt.toISOString() : '',
    timeToFix: e.timeToFix ?? '',
    currentState: e.currentState,
    currentSeverity: resolveEffectiveSeverity(e) ?? '',
    currentPriority: e.currentPriority,
    contextualExplanation: e.contextualExplanation ?? '',
    language: e.language,
    path: e.path,
    vulnerableStartLine: e.vulnerableStartLine,
    vulnerableEndLine: e.vulnerableEndLine,
    vulnerability: e.vulnerability
      ? mapVulnerabilityEntityToMetadata(e.vulnerability)
      : undefined,
    historyItems: undefined, // no history here
    codeSnippets: e.codeSnippets?.map(mapCodeSnippetEntityToInterface) ?? [],
    vulnerabilityType: 'cicd',
    scannerRuleId: e.scannerRuleId || undefined,
    hasCybeAnalysis,
    hasCybeAutofix,
    autofixRecords: (e as any).autofixRecords
      ? (e as any).autofixRecords.map((r: any) => ({
          id: r.id,
          branch: r.branch,
          prUrl: r.prUrl || '',
          status: r.status,
          reason: r.reason || '',
          commitMessage: r.commitMessage,
          prTitle: r.prTitle,
          prBody: r.prBody,
          diff: r.diff || '',
          createdAt: r.createdAt?.toISOString() || '',
          updatedAt: r.updatedAt?.toISOString() || '',
        }))
      : [],
    branch: e.branch || undefined,
    scoringSource: resolveScoringSource(e),
    cvss4Vector: e.cvss4Vector ?? undefined,
    cvss4BaseScore: e.cvss4BaseScore ?? undefined,
    cvss4EnvironmentalScore: e.cvss4EnvironmentalScore ?? undefined,
    cvss4EnvironmentalVector: e.cvss4EnvironmentalVector ?? undefined,
    epssScore: e.epssScore ?? undefined,
    epssPercentile: e.epssPercentile ?? undefined,
    epssRefreshedAt: e.epssRefreshedAt?.toISOString() ?? undefined,
    exploitabilityScore: e.exploitabilityScore ?? undefined,
    exploitabilityVerdict: e.exploitabilityVerdict ?? undefined,
    exploitabilityReason: e.exploitabilityReason ?? undefined,
    exploitabilityScoreReason: e.exploitabilityScoreReason ?? undefined,
    exploitabilitySource: e.exploitabilitySource ?? undefined,
    exploitabilityUpdatedAt:
      e.exploitabilityUpdatedAt?.toISOString() ?? undefined,
    priorityScore: e.priorityScore ?? undefined,
    cvssExplanation: explainer?.buildExplanationForEntity(e),
    exploitabilityStale: computeExploitabilityStale(
      e,
      securityContextUpdatedAt,
    ),
    securityContextUpdatedAt:
      securityContextUpdatedAt?.toISOString() ?? undefined,
  };
}

/**
 * Final ts-proto wrapper: only `base` is returned for CICD.
 */
export function mapCicdDetectionToProto(
  e: CicdVulnerabilityDetections,
  explainer?: CvssExplainerService,
  securityContextUpdatedAt?: Date | null,
): VulnerabilityCicd {
  return {
    base: mapCicdDetectionEntityToInterface(
      e,
      explainer,
      securityContextUpdatedAt,
    ),
  };
}

// -------------------------------------------------------------------
// Secret Mapping Functions
// -------------------------------------------------------------------

export function mapSecretDetectionEntityToInterface(
  e: SecretVulnerabilityDetections,
  explainer?: CvssExplainerService,
): VulnerabilitySastIacResponse {
  // Check if the AI agent has analyzed this vulnerability (userId = 'system')
  const hasCybeAnalysis = Array.isArray((e as any).historyItems)
    ? (e as any).historyItems.some((h: any) => h.userId === 'system')
    : false;

  // Check if vulnerability has autofix records
  const hasCybeAutofix = Array.isArray((e as any).autofixRecords)
    ? (e as any).autofixRecords.length > 0
    : false;

  return {
    id: e.id,
    projectId: e.projectId,
    createdAt: e.createdAt ? e.createdAt.toISOString() : '',
    updateAt: e.updateAt ? e.updateAt.toISOString() : '',
    timeToFix: e.timeToFix ?? '',
    currentState: e.currentState,
    currentSeverity: resolveEffectiveSeverity(e) ?? '',
    currentPriority: e.currentPriority,
    contextualExplanation: e.contextualExplanation ?? '',
    language: e.language,
    path: e.path,
    vulnerableStartLine: e.vulnerableStartLine,
    vulnerableEndLine: e.vulnerableEndLine,
    vulnerability: e.vulnerability
      ? mapVulnerabilityEntityToMetadata(e.vulnerability)
      : undefined,
    historyItems: undefined, // no history here
    codeSnippets: e.codeSnippets?.map(mapCodeSnippetEntityToInterface) ?? [],
    vulnerabilityType: 'secret',
    scannerRuleId: e.scannerRuleId || undefined,
    hasCybeAnalysis,
    hasCybeAutofix,
    autofixRecords: (e as any).autofixRecords
      ? (e as any).autofixRecords.map((r: any) => ({
          id: r.id,
          branch: r.branch,
          prUrl: r.prUrl || '',
          status: r.status,
          reason: r.reason || '',
          commitMessage: r.commitMessage,
          prTitle: r.prTitle,
          prBody: r.prBody,
          diff: r.diff || '',
          createdAt: r.createdAt?.toISOString() || '',
          updatedAt: r.updatedAt?.toISOString() || '',
        }))
      : [],
    branch: e.branch || undefined,
    scoringSource: resolveScoringSource(e),
    cvss4Vector: e.cvss4Vector ?? undefined,
    cvss4BaseScore: e.cvss4BaseScore ?? undefined,
    cvss4EnvironmentalScore: e.cvss4EnvironmentalScore ?? undefined,
    cvss4EnvironmentalVector: e.cvss4EnvironmentalVector ?? undefined,
    epssScore: e.epssScore ?? undefined,
    epssPercentile: e.epssPercentile ?? undefined,
    epssRefreshedAt: e.epssRefreshedAt?.toISOString() ?? undefined,
    exploitabilityScore: e.exploitabilityScore ?? undefined,
    exploitabilityVerdict: e.exploitabilityVerdict ?? undefined,
    exploitabilityReason: e.exploitabilityReason ?? undefined,
    exploitabilityScoreReason: e.exploitabilityScoreReason ?? undefined,
    exploitabilitySource: e.exploitabilitySource ?? undefined,
    exploitabilityUpdatedAt:
      e.exploitabilityUpdatedAt?.toISOString() ?? undefined,
    priorityScore: e.priorityScore ?? undefined,
    cvssExplanation: explainer?.buildExplanationForEntity(e),
  };
}

/**
 * Final ts-proto wrapper: returns `base` + secret-specific fields.
 */
export function mapSecretDetectionToProto(
  e: SecretVulnerabilityDetections,
  explainer?: CvssExplainerService,
): VulnerabilitySecret {
  return {
    base: mapSecretDetectionEntityToInterface(e, explainer),
    hasEncryptedSecret:
      e.encryptedSecret != null && e.encryptedSecret.length > 0,
    commitSha: e.commitSha || undefined,
    source: e.source || undefined,
  };
}

// -------------------------------------------------------------------
// Light list-mode wrappers (dashboard paginated list endpoints)
// -------------------------------------------------------------------

/**
 * Routes detection-level mapping through the light metadata mapper. Used by
 * the four paginated list endpoints (sast / iac / cicd / secret). Keeps the
 * SAST detail mapper (the full one) untouched.
 *
 * Implementation note: rather than duplicating ~80 lines of base-field
 * mapping per scanner, we re-use the existing full detection mappers and
 * override the `vulnerability` (metadata) field with the light version.
 * The dashboard list never reads the heavy fields, so this is safe.
 */
function withListMetadata<T extends { vulnerability?: VulnerabilityMetadata }>(
  full: T,
  rawVuln: Vulnerability | undefined,
): T {
  if (!rawVuln) return full;
  return {
    ...full,
    vulnerability: mapVulnerabilityEntityToListMetadata(rawVuln),
  };
}

export function mapSastDetectionEntityToListInterface(
  e: SastVulnerabilityDetections,
  explainer?: CvssExplainerService,
  securityContextUpdatedAt?: Date | null,
): VulnerabilitySastIacResponse {
  return withListMetadata(
    mapSastDetectionEntityToInterface(e, explainer, securityContextUpdatedAt),
    e.vulnerability,
  );
}

export function mapIacDetectionEntityToListInterface(
  e: IacVulnerabilityDetections,
  explainer?: CvssExplainerService,
  securityContextUpdatedAt?: Date | null,
): VulnerabilitySastIacResponse {
  return withListMetadata(
    mapIacDetectionEntityToInterface(e, explainer, securityContextUpdatedAt),
    e.vulnerability,
  );
}

export function mapCicdDetectionEntityToListInterface(
  e: CicdVulnerabilityDetections,
  explainer?: CvssExplainerService,
  securityContextUpdatedAt?: Date | null,
): VulnerabilitySastIacResponse {
  return withListMetadata(
    mapCicdDetectionEntityToInterface(e, explainer, securityContextUpdatedAt),
    e.vulnerability,
  );
}

export function mapSecretDetectionEntityToListInterface(
  e: SecretVulnerabilityDetections,
  explainer?: CvssExplainerService,
): VulnerabilitySastIacResponse {
  return withListMetadata(
    mapSecretDetectionEntityToInterface(e, explainer),
    e.vulnerability,
  );
}
