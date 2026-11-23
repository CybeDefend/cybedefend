// analysis-reporting-service/src/modules/sca/sca.mapper.ts

import {
  ScaDetectedLibraryDto,
  VulnerabilitySca,
  VulnerabilitySastIacResponse,
  VulnerabilityScaMetadata,
  HistoryItemsWrapper,
  ScaDetectedPackage,
  HistoryItem,
} from '@grpc/analysis-reporting/result';
import { ScaDetectedPackages } from 'src/entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { VulnerabilityOsv } from 'src/entities/osv';
import { calculateOsvCvssScore, getMinFixedAbove } from './sca.utils';
import { CvssExplainerService } from 'src/modules/cvss/cvss-explainer.service';
import { resolveEffectiveSeverity } from 'src/modules/cvss/severity-from-cvss';

function resolveScoringSource(
  e: ScaVulnerabilityDetections,
): 'static' | 'agent' {
  return e.scoringSource === 'agent' || e.exploitabilitySource === 'agent'
    ? 'agent'
    : (e.scoringSource ?? 'static');
}

/**
 * Transforms a VulnerabilityOsv entity into the public VulnerabilityScaMetadata DTO.
 * This version dynamically extracts additional data from the `databaseSpecific` JSON blob.
 * @param e The VulnerabilityOsv entity from the database.
 */
export function mapVulnerabilityScaEntityToMetadata(
  e: VulnerabilityOsv,
  // When the installed package version is known, the recommended fix is the
  // smallest `fixed` strictly above it (never a downgrade like 7.5.3 for an
  // installed 7.5.13); empty when the install is already past every listed fix.
  installedVersion?: string,
): VulnerabilityScaMetadata {
  const cve = e.aliases?.find((a) => a.alias.startsWith('CVE-'))?.alias ?? '';
  const ghsaId =
    e.aliases?.find((a) => a.alias.startsWith('GHSA-'))?.alias ??
    (e.id.startsWith('GHSA-') ? e.id : '');

  const dbSpecific = e.databaseSpecific || {};

  const cwes =
    dbSpecific.cwe_ids && Array.isArray(dbSpecific.cwe_ids)
      ? dbSpecific.cwe_ids.map((cweId: string) => ({ id: cweId, cweId: cweId }))
      : [];

  const githubReviewedAt = dbSpecific.github_reviewed_at
    ? new Date(dbSpecific.github_reviewed_at).toISOString()
    : '';
  const nvdPublishedAt = dbSpecific.nvd_published_at
    ? new Date(dbSpecific.nvd_published_at).toISOString()
    : '';

  return {
    id: e.id,
    internalId: e.internalId || '',
    ghsaId: ghsaId,
    cve: cve,
    summary: e.summary || '',
    details: e.details || '',
    severityGh:
      (typeof dbSpecific.severity === 'string' ? dbSpecific.severity : '') ||
      '',
    schemaVersion: e.schemaVersion || '',
    modifiedAt: e.modifiedAt?.toISOString() ?? '',
    publishedAt: e.publishedAt?.toISOString() ?? '',
    githubReviewedAt: githubReviewedAt,
    nvdPublishedAt: nvdPublishedAt,
    cwes: cwes,
    createdAt: e.createdAt?.toISOString() ?? '',
    updatedAt: e.updatedAt?.toISOString() ?? '',
    aliases: e.aliases?.map((a) => ({ id: a.id, alias: a.alias })) ?? [],
    references:
      e.references?.map((r) => ({ id: r.id, type: r.type, url: r.url })) ?? [],
    severities:
      e.severities?.map((s) => ({ id: s.id, type: s.type, score: s.score })) ??
      [],
    packages:
      e.affected?.map((a) => {
        const allFixed =
          a.ranges?.flatMap((range) =>
            range.events
              .filter((event) => !!event.fixed)
              .map((event) => event.fixed as string),
          ) ?? [];
        const firstFixed =
          a.ranges
            ?.find((r) => r.events.some((ev) => ev.fixed))
            ?.events.find((ev) => ev.fixed)?.fixed ?? '';
        // Installed-aware recommendation: the smallest fix strictly above the
        // installed version (never a downgrade). Falls back to the first fixed
        // event when the installed version is unknown (non-detection callers).
        const fixed = installedVersion
          ? (getMinFixedAbove(allFixed, installedVersion) ?? '')
          : firstFixed;
        return {
          id: a.id,
          ecosystem: a.ecosystem,
          packageName: a.packageName,
          introduced:
            a.ranges?.[0]?.events?.find((ev) => ev.introduced)?.introduced ??
            '0',
          fixed,
          fixAvailable: installedVersion ? !!fixed : allFixed.length > 0,
        };
      }) ?? [],
  };
}

/**
 * Transforms a ScaVulnerabilityDetections entity (now linked to OSV)
 * into the public VulnerabilitySca DTO for API responses.
 * @param e The ScaVulnerabilityDetections entity.
 */
export function mapScaDetectionEntityToInterface(
  e: ScaVulnerabilityDetections,
  explainer?: CvssExplainerService,
): VulnerabilitySca {
  // 1. Build the base response from the detection record itself.
  const base: VulnerabilitySastIacResponse = {
    id: e.id,
    projectId: e.projectId,
    createdAt: e.createdAt?.toISOString() ?? '',
    updateAt: e.updatedAt?.toISOString() ?? '',
    timeToFix: e.timeToFix || '',
    currentState: e.currentState,
    currentSeverity: resolveEffectiveSeverity(e) ?? '',
    currentPriority: e.currentPriority || '',
    vulnerabilityType: 'sca',
    // Fields not relevant to SCA are empty.
    contextualExplanation: '',
    language: '',
    path: '',
    vulnerableStartLine: 0,
    vulnerableEndLine: 0,
    codeSnippets: [],
    vulnerability: undefined, // Will be replaced by the top-level metadata
    historyItems: undefined,
    autofixRecords: [],
    hasCybeAnalysis: false,
    hasCybeAutofix: false,
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
  };

  // 2. Build the detected library DTO.
  let library: ScaDetectedLibraryDto | undefined;
  if (e.scaDetectedPackage) {
    library = {
      id: e.scaDetectedPackage.id,
      projectId: e.scaDetectedPackage.projectId,
      packageName: e.scaDetectedPackage.packageName,
      packageVersion: e.scaDetectedPackage.packageVersion,
      fileName: e.scaDetectedPackage.fileName || '',
      ecosystem: e.scaDetectedPackage.ecosystem || '',
      isTransitive: e.scaDetectedPackage.isTransitive || false,
      isDev: e.scaDetectedPackage.isDev || false,
      path: e.scaDetectedPackage.path || [],
      dependencyInfoAvailable:
        e.scaDetectedPackage.dependencyInfoAvailable ?? true,
      reachability: e.scaDetectedPackage.reachability || undefined,
      importLocations: (e.scaDetectedPackage.importLocations || []).map(
        (loc) => ({
          file: loc.file,
          line: loc.line,
          content: loc.content ?? '',
        }),
      ),
      licenses: e.scaDetectedPackage.licenses || [],
    };
  }

  // 3. Build the vulnerability metadata from the linked OSV record.
  let metadata: VulnerabilityScaMetadata | undefined;
  if (e.vulnerability) {
    metadata = mapVulnerabilityScaEntityToMetadata(
      e.vulnerability,
      e.scaDetectedPackage?.packageVersion,
    );
  }
  // Resolve cvssScore with a deterministic precedence:
  //   1. The persisted `currentCVSS` column on the detection (used as the
  //      source of truth for server-side ordering — see sca.service.ts list
  //      query). Always trust it when non-zero.
  //   2. Live computation from the linked OSV severities, when the relation
  //      was loaded.
  //   3. 0 (proto3 `double` defaults to 0; the front already treats 0 as N/A).
  // Without precedence (1), detections returned without the `vulnerability`
  // relation lost their score in the listing even though the column was set.
  let cvssScore = 0;
  if (e.currentCVSS != null && e.currentCVSS > 0) {
    cvssScore = Number(e.currentCVSS);
  } else if (e.vulnerability) {
    cvssScore = calculateOsvCvssScore(e.vulnerability);
  }

  // 4. Map SCA AutoFix records if available.
  const autofixRecords = (e.scaAutofixRecords || []).map((r) => ({
    id: r.id,
    branch: r.branch || '', // Branch name where the fix was applied
    prUrl: r.prUrl || '', // URL of the created PR
    status: r.status || 'pending',
    reason: r.errorMessage || '',
    commitMessage: '', // Not applicable for SCA
    prTitle: '', // Not applicable for SCA
    prBody: '', // Not applicable for SCA
    diff: '', // Not applicable for SCA
    createdAt: r.createdAt?.toISOString() || '',
    updatedAt: r.updatedAt?.toISOString() || '',
    // SCA-specific fields (custom extension)
    cveId: r.cveId || '',
    vulnerablePackage: r.vulnerablePackage || '',
    vulnerableVersion: r.vulnerableVersion || '',
    recommendedParentPackage: r.recommendedParentPackage || '',
    recommendedCurrentVersion: r.recommendedCurrentVersion || '',
    recommendedProposedVersion: r.recommendedProposedVersion || '',
    recommendedUpdateType: r.recommendedUpdateType || '',
    installCommand: r.installCommand || '',
    hasFixAvailable: r.hasFixAvailable || false,
  }));

  // 5. Determine if any autofix is available
  const hasAutofix =
    autofixRecords.length > 0 &&
    autofixRecords.some((r) => r.hasFixAvailable || r.status === 'ok');

  // 6. Check if the AI agent has analyzed this vulnerability (userId = 'system')
  const hasCybeAnalysis = Array.isArray((e as any).historyItems)
    ? (e as any).historyItems.some((h: any) => h.userId === 'system')
    : false;

  return {
    base,
    library,
    cvssScore,
    metadata,
    hasAutofix,
    autofixRecords,
    hasCybeAnalysis,
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
    isMalware: e.isMalware ?? false,
  };
}

/**
 * Maps a ScaDetectedPackages entity to the public gRPC interface.
 */
export function mapScaPackageEntityToInterface(
  e: ScaDetectedPackages,
): ScaDetectedPackage {
  return {
    id: e.id,
    projectId: e.projectId,
    packageName: e.packageName,
    packageVersion: e.packageVersion,
    fileName: e.fileName || '',
    ecosystem: e.ecosystem || '',
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    isTransitive: e.isTransitive,
    isDev: e.isDev,
    path: e.path || [],
    dependencyInfoAvailable: e.dependencyInfoAvailable ?? true,
    reachability: e.reachability || undefined,
    importLocations: (e.importLocations || []).map((loc) => ({
      file: loc.file,
      line: loc.line,
      content: loc.content ?? '',
    })),
    licenses: e.licenses || [],
  };
}

/**
 * Maps history items for detailed view.
 */
export function mapHistoryItemsToInterface(
  historyItems: any[],
): HistoryItemsWrapper {
  const items: HistoryItem[] = historyItems.map((item) => ({
    id: item.id,
    type: item.type || 'status_change',
    value: item.value || item.newState || '',
    date: item.date,
    userId: item.userId,
    user: item.user,
  }));

  return {
    items,
  };
}

export interface ScaListPackageHint {
  packageName: string;
  ecosystem: string;
  hasFix: boolean;
  fixedVersion: string;
}

/**
 * Light variant of {@link mapVulnerabilityScaEntityToMetadata} used by the
 * paginated list endpoint. The full mapper joins `osv.aliases / severities /
 * references / affected / ranges / events`, which can push the gRPC response
 * past the 50 MB limit on projects with hundreds of critical findings
 * (the chat agent gets RESOURCE_EXHAUSTED).
 *
 * This mapper keeps the proto shape but emits empty `aliases / severities /
 * references` and a single synthesized `packages` entry whose `fixAvailable`
 * flag is computed by the caller (a cheap EXISTS subquery, not by loading the
 * full event tree). `details` is dropped — the dashboard list does not render
 * it; the detail endpoint still returns the full mapper.
 */
export function mapVulnerabilityScaEntityToListMetadata(
  e: VulnerabilityOsv,
  pkg: ScaListPackageHint,
  cveHint?: string,
): VulnerabilityScaMetadata {
  // List-mode skips the heavy `osv.aliases` join, so the CVE is resolved cheaply
  // by the caller (loadCveMap) and passed in as `cveHint`. Fall back to aliases
  // (detail path, where they are loaded) or a CVE-shaped id otherwise.
  const cve =
    cveHint ||
    e.aliases?.find((a) => a.alias.startsWith('CVE-'))?.alias ||
    (e.id.startsWith('CVE-') ? e.id : '');
  const ghsaId =
    e.aliases?.find((a) => a.alias.startsWith('GHSA-'))?.alias ??
    (e.id.startsWith('GHSA-') ? e.id : '');

  const dbSpecific = e.databaseSpecific || {};
  const cwes =
    dbSpecific.cwe_ids && Array.isArray(dbSpecific.cwe_ids)
      ? dbSpecific.cwe_ids.map((cweId: string) => ({ id: cweId, cweId: cweId }))
      : [];
  const githubReviewedAt = dbSpecific.github_reviewed_at
    ? new Date(dbSpecific.github_reviewed_at).toISOString()
    : '';
  const nvdPublishedAt = dbSpecific.nvd_published_at
    ? new Date(dbSpecific.nvd_published_at).toISOString()
    : '';

  const packages =
    pkg.packageName && pkg.ecosystem
      ? [
          {
            id: '',
            ecosystem: pkg.ecosystem,
            packageName: pkg.packageName,
            introduced: '0',
            fixed: pkg.fixedVersion || '',
            fixAvailable: pkg.hasFix,
          },
        ]
      : [];

  return {
    id: e.id,
    internalId: e.internalId || '',
    ghsaId,
    cve,
    summary: e.summary || '',
    details: '', // intentionally empty in list mode
    severityGh:
      (typeof dbSpecific.severity === 'string' ? dbSpecific.severity : '') ||
      '',
    schemaVersion: e.schemaVersion || '',
    modifiedAt: e.modifiedAt?.toISOString() ?? '',
    publishedAt: e.publishedAt?.toISOString() ?? '',
    githubReviewedAt,
    nvdPublishedAt,
    cwes,
    createdAt: e.createdAt?.toISOString() ?? '',
    updatedAt: e.updatedAt?.toISOString() ?? '',
    aliases: [],
    references: [],
    severities: [],
    packages,
  };
}

export interface ScaListFixHint {
  hasFix: boolean;
  fixedVersion: string;
}

/**
 * List-mode counterpart of {@link mapScaDetectionEntityToInterface}. Builds the
 * same `VulnerabilitySca` envelope (so the proto shape and proto field numbers
 * match), but routes metadata through {@link mapVulnerabilityScaEntityToListMetadata}
 * and uses the caller-provided `ScaListFixHint` instead of inspecting
 * `osv.affected.ranges.events`.
 *
 * The detail endpoint MUST keep using the full mapper.
 */
export function mapScaDetectionEntityToListInterface(
  e: ScaVulnerabilityDetections,
  fix: ScaListFixHint,
  explainer?: CvssExplainerService,
  cveHint?: string,
): VulnerabilitySca {
  const base: VulnerabilitySastIacResponse = {
    id: e.id,
    projectId: e.projectId,
    createdAt: e.createdAt?.toISOString() ?? '',
    updateAt: e.updatedAt?.toISOString() ?? '',
    timeToFix: e.timeToFix || '',
    currentState: e.currentState,
    currentSeverity: resolveEffectiveSeverity(e) ?? '',
    currentPriority: e.currentPriority || '',
    vulnerabilityType: 'sca',
    // Fields not relevant to SCA are empty.
    contextualExplanation: '',
    language: '',
    path: '',
    vulnerableStartLine: 0,
    vulnerableEndLine: 0,
    codeSnippets: [],
    vulnerability: undefined,
    historyItems: undefined,
    autofixRecords: [],
    hasCybeAnalysis: false,
    hasCybeAutofix: false,
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
  };

  let library: ScaDetectedLibraryDto | undefined;
  if (e.scaDetectedPackage) {
    library = {
      id: e.scaDetectedPackage.id,
      projectId: e.scaDetectedPackage.projectId,
      packageName: e.scaDetectedPackage.packageName,
      packageVersion: e.scaDetectedPackage.packageVersion,
      fileName: e.scaDetectedPackage.fileName || '',
      ecosystem: e.scaDetectedPackage.ecosystem || '',
      isTransitive: e.scaDetectedPackage.isTransitive || false,
      isDev: e.scaDetectedPackage.isDev || false,
      path: e.scaDetectedPackage.path || [],
      dependencyInfoAvailable:
        e.scaDetectedPackage.dependencyInfoAvailable ?? true,
      reachability: e.scaDetectedPackage.reachability || undefined,
      importLocations: (e.scaDetectedPackage.importLocations || []).map(
        (loc) => ({
          file: loc.file,
          line: loc.line,
          content: loc.content ?? '',
        }),
      ),
      licenses: e.scaDetectedPackage.licenses || [],
    };
  }

  // Route metadata through the light mapper. The caller has already resolved
  // `hasFix / fixedVersion` via a cheap EXISTS query — we do not touch
  // `osv.affected.ranges.events` here.
  let metadata: VulnerabilityScaMetadata | undefined;
  if (e.vulnerability) {
    metadata = mapVulnerabilityScaEntityToListMetadata(
      e.vulnerability,
      {
        packageName: e.scaDetectedPackage?.packageName ?? '',
        ecosystem: e.scaDetectedPackage?.ecosystem ?? '',
        hasFix: fix.hasFix,
        fixedVersion: fix.fixedVersion,
      },
      cveHint,
    );
  }

  // Reuse the exact precedence rules from mapScaDetectionEntityToInterface so
  // list ordering by CVSS stays consistent with the detail score.
  let cvssScore = 0;
  if (e.currentCVSS != null && e.currentCVSS > 0) {
    cvssScore = Number(e.currentCVSS);
  } else if (e.vulnerability) {
    cvssScore = calculateOsvCvssScore(e.vulnerability);
  }

  const autofixRecords = (e.scaAutofixRecords || []).map((r) => ({
    id: r.id,
    branch: r.branch || '',
    prUrl: r.prUrl || '',
    status: r.status || 'pending',
    reason: r.errorMessage || '',
    commitMessage: '',
    prTitle: '',
    prBody: '',
    diff: '',
    createdAt: r.createdAt?.toISOString() || '',
    updatedAt: r.updatedAt?.toISOString() || '',
    cveId: r.cveId || '',
    vulnerablePackage: r.vulnerablePackage || '',
    vulnerableVersion: r.vulnerableVersion || '',
    recommendedParentPackage: r.recommendedParentPackage || '',
    recommendedCurrentVersion: r.recommendedCurrentVersion || '',
    recommendedProposedVersion: r.recommendedProposedVersion || '',
    recommendedUpdateType: r.recommendedUpdateType || '',
    installCommand: r.installCommand || '',
    hasFixAvailable: r.hasFixAvailable || false,
  }));

  const hasAutofix =
    autofixRecords.length > 0 &&
    autofixRecords.some((r) => r.hasFixAvailable || r.status === 'ok');

  const hasCybeAnalysis = Array.isArray((e as any).historyItems)
    ? (e as any).historyItems.some((h: any) => h.userId === 'system')
    : false;

  return {
    base,
    library,
    cvssScore,
    metadata,
    hasAutofix,
    autofixRecords,
    hasCybeAnalysis,
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
    isMalware: e.isMalware ?? false,
  };
}
