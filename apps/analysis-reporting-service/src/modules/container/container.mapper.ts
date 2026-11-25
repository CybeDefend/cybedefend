import {
  ContainerVulnerability,
  ContainerVulnerabilityDetection,
  HistoryItemsWrapper,
  ContainerPackage,
  CVSSInfo,
  VulnerabilityCounts,
} from '@grpc/analysis-reporting/result';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { VulnerabilityOsv } from 'src/entities/osv';
import { calculateOsvCvssScore, getMinFixedAbove } from '../sca/sca.utils';
import { CvssExplainerService } from '../cvss/cvss-explainer.service';
import { resolveEffectiveSeverity } from '../cvss/severity-from-cvss';
import { displayedCveOf } from '../results-import/imported-advisory.view';

function resolveScoringSource(
  d: VulnerabilityDetectionsContainer,
): 'static' | 'agent' {
  return d.scoringSource === 'agent' || d.exploitabilitySource === 'agent'
    ? 'agent'
    : (d.scoringSource ?? 'static');
}

/**
 * One row of the per-image severity aggregate
 * (`GROUP BY det.detectedImageId, effectiveSeveritySql('det')`).
 */
export interface ImageSeverityCountRow {
  imageId: string;
  // NULL when a detection has no CVSS score and no label.
  severity: string | null;
  // COUNT(), a string from mysql2.
  count: string | number;
}

/**
 * Folds the per-image severity aggregate into one VulnerabilityCounts per
 * image, for both the flat and the grouped image lists.
 *
 * Every row ADDS to its bucket, so the result does not depend on the row
 * order, which MySQL does not guarantee for a GROUP BY. critical / high /
 * medium / low have their own bucket; anything else (NULL, 'none' from a zero
 * score, 'unknown' from Trivy's UNKNOWN, a stray label) is unknown. The flat
 * list used to ASSIGN the 'unknown' row over what the NULL rows had added.
 */
export function tallyImageSeverityCounts(
  rows: ImageSeverityCountRow[],
): Map<string, VulnerabilityCounts> {
  const countsByImage = new Map<string, VulnerabilityCounts>();
  for (const row of rows) {
    let counts = countsByImage.get(row.imageId);
    if (!counts) {
      counts = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
      countsByImage.set(row.imageId, counts);
    }
    const count = Number.parseInt(String(row.count), 10) || 0;
    const severity = row.severity?.toLowerCase();
    if (
      severity === 'critical' ||
      severity === 'high' ||
      severity === 'medium' ||
      severity === 'low'
    ) {
      counts[severity] += count;
    } else {
      counts.unknown += count;
    }
  }
  return countsByImage;
}

/**
 * Finds the fixed version for a specific package from the OSV vulnerability data.
 * It intelligently compares the OSV package name against both the detected package name
 * and its source name (`srcName`) to handle discrepancies between binary and source packages.
 * @param osv - The VulnerabilityOsv entity, potentially enriched with alias data.
 * @param detection - The full detection entity.
 * @returns The fixed version string if found, otherwise an empty string.
 */
export function findFixedVersionForPackage(
  osv: VulnerabilityOsv,
  detection: VulnerabilityDetectionsContainer,
): string {
  const detectedPackage = detection.detectedPackage;
  if (!osv.affected || !detectedPackage) return '';

  const targetPkgName = detectedPackage.packageName.toLowerCase();
  const srcPkgName = (
    detectedPackage.srcName || detectedPackage.packageName
  ).toLowerCase();

  for (const affected of osv.affected) {
    const affectedPkgName = affected.packageName?.toLowerCase();
    if (!affectedPkgName) continue;

    if (affectedPkgName === targetPkgName || affectedPkgName === srcPkgName) {
      for (const range of affected.ranges ?? []) {
        for (const event of range.events ?? []) {
          if (event.fixed) {
            return event.fixed;
          }
        }
      }
    }
  }
  return '';
}

/**
 * Installed-aware recommended fix for a container detection. The enrichment
 * pipeline stores `fixedVersion` as a comma-separated list of every fixed
 * version of the CVE; for language packages (semver) we surface only the
 * smallest fix STRICTLY ABOVE the installed version (never a downgrade like
 * minimatch 9.0.6 for an installed 9.0.9), and empty when already past every
 * fix. OS packages (deb/rpm/apk) keep the stored value verbatim — their
 * versions are distro-specific and not semver-comparable.
 *
 * Exported so the grouped container view (grouped-vulnerability.service) shares
 * this exact computation — the list and the detail panel must agree on the
 * recommended fix, never one showing the full downgrade list and the other a
 * single version.
 */
export function installedAwareContainerFix(
  d: VulnerabilityDetectionsContainer,
): string {
  const stored = d.fixedVersion ?? '';
  if (d.detectedPackage?.class !== 'lang-pkgs') return stored;
  const candidates = stored
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (candidates.length === 0) return '';
  return (
    getMinFixedAbove(candidates, d.detectedPackage.packageVersion ?? '') ?? ''
  );
}

function mapOsvToContainerVuln(
  e: VulnerabilityOsv,
  detection: VulnerabilityDetectionsContainer,
): ContainerVulnerability | undefined {
  if (!e) return undefined;

  // The same rule as the SCA reads: the id when it is a CVE, else the first
  // CVE alias (sorted), else the id.
  const cve =
    displayedCveOf(
      e.id,
      (e.aliases ?? []).map((a) => a.alias),
    ) || e.id;
  const cvssScores: { [key: string]: CVSSInfo } = {};

  // The 'e' entity is now potentially enriched with alias data for CVSS scoring
  const score = calculateOsvCvssScore(e);

  if (score > 0) {
    const vectorV3 =
      e.severities?.find((s) => s.type.includes('CVSS_V3'))?.score ?? undefined;
    const vectorV2 =
      e.severities?.find((s) => s.type.includes('CVSS_V2'))?.score ?? undefined;

    cvssScores['nvd'] = {
      v3Vector: vectorV3 ?? '',
      v2Vector: vectorV2 ?? '',
      v3Score: score, // Always show the score when it is computed
      v2Score: undefined,
    };
  }

  // The enrichment pipeline stores the full set of fixed versions; surface only
  // the installed-aware recommendation (smallest fix above the install).
  const fixedVersion = installedAwareContainerFix(detection);

  return {
    vulnerabilityId: cve,
    title: e.summary ?? '',
    description: e.details ?? '',
    references: e.references?.map((r) => r.url) ?? [],
    cvss: cvssScores,
    cweIds: (e.databaseSpecific as any)?.cwe_ids ?? [],
    primaryUrl: e.references?.find((r) => r.type === 'ADVISORY')?.url ?? '',
    publishedDate: e.publishedAt?.toISOString() ?? '',
    lastModifiedDate: e.modifiedAt?.toISOString() ?? '',
    internalId: e.internalId ?? '',
    pkgName: detection.detectedPackage.packageName,
    installedVersion: detection.detectedPackage.packageVersion,
    fixedVersion: fixedVersion, // Use the pre-calculated value
    severity: resolveEffectiveSeverity(detection) ?? '',
    target: detection.detectedPackage.target ?? '',
    class: detection.detectedPackage.class ?? '',
    layerDigest: '',
    type: '',
    dataSource: undefined,
  };
}

export function mapDetectionEntity(
  d: VulnerabilityDetectionsContainer,
  explainer?: CvssExplainerService,
): ContainerVulnerabilityDetection {
  const hist: HistoryItemsWrapper = {
    items:
      d.historyItems?.map((h) => ({
        id: h.id,
        type: h.type,
        value: h.value,
        date: h.date?.toISOString() ?? '',
        userId: h.userId ?? '',
        user: undefined,
      })) ?? [],
  };

  const pkg: ContainerPackage | undefined = d.detectedPackage
    ? {
        id: d.detectedPackage.id,
        name: d.detectedPackage.packageName,
        version: d.detectedPackage.packageVersion,
        arch: d.detectedPackage.arch,
        srcName: d.detectedPackage.srcName,
        srcVersion: d.detectedPackage.srcVersion,
        // Not persisted on the package row (match-time only).
        fullVersion: '',
        srcFullVersion: '',
        digest: d.detectedPackage.digest,
        licenses: JSON.parse(d.detectedPackage.licenses ?? '[]'),
        dependsOn: d.detectedPackage.dependsOn ?? [],
      }
    : undefined;

  const vuln = mapOsvToContainerVuln(d.vulnerability, d);

  return {
    id: d.id,
    projectId: d.projectId,
    vulnerabilityIdentifier: d.vulnerabilityIdentifier,
    currentState: d.currentState,
    currentSeverity: resolveEffectiveSeverity(d) ?? '',
    currentPriority: d.currentPriority,
    fixedVersion: installedAwareContainerFix(d),
    package: pkg,
    vuln: vuln,
    historyItems: hist,
    createdAt: d.createdAt?.toISOString() ?? '',
    updatedAt: d.updatedAt?.toISOString() ?? '',
    branch: d.branch || undefined,
    scoringSource: resolveScoringSource(d),
    // Rows written before the column exist are scanner-reported.
    detectionSource: d.detectionSource ?? 'scanner',
    cvss4Vector: d.cvss4Vector ?? undefined,
    cvss4BaseScore: d.cvss4BaseScore ?? undefined,
    cvss4EnvironmentalScore: d.cvss4EnvironmentalScore ?? undefined,
    cvss4EnvironmentalVector: d.cvss4EnvironmentalVector ?? undefined,
    epssScore: d.epssScore ?? undefined,
    epssPercentile: d.epssPercentile ?? undefined,
    epssRefreshedAt: d.epssRefreshedAt?.toISOString() ?? undefined,
    exploitabilityScore: d.exploitabilityScore ?? undefined,
    exploitabilityVerdict: d.exploitabilityVerdict ?? undefined,
    exploitabilityReason: d.exploitabilityReason ?? undefined,
    exploitabilityScoreReason: d.exploitabilityScoreReason ?? undefined,
    exploitabilitySource: d.exploitabilitySource ?? undefined,
    exploitabilityUpdatedAt:
      d.exploitabilityUpdatedAt?.toISOString() ?? undefined,
    priorityScore: d.priorityScore ?? undefined,
    cvssExplanation: explainer?.buildExplanationForEntity(d),
    // Legacy CVSS v3 base score — persisted at ingestion (Trivy), with the
    // OSV-computed score as fallback (SCA parity, cf. sca.mapper cvssScore).
    cvssScore: d.cvssScore ?? vuln?.cvss?.['nvd']?.v3Score ?? undefined,
  };
}

/**
 * Naming-convention alias for {@link mapDetectionEntity}. Lets consumers
 * import a name symmetric to the other scanner mappers (sast/iac/cicd/secret/sca)
 * and to the list-mode variant declared below. The detail endpoint keeps
 * using this full mapper — no behavior change.
 */
export const mapContainerDetectionEntityToInterface = mapDetectionEntity;

/**
 * List-mode counterpart of {@link mapContainerDetectionEntityToInterface}.
 *
 * The container list query (container.service.ts) already avoids the
 * heavy OSV cascade — only `det.vulnerability` (the scalar OSV row) is
 * joined. The remaining bloat comes from the OSV `details` markdown field
 * (mapped to `vuln.description`) and the `references` array (mapped to
 * `vuln.references`). Both are dropped in list mode; the detail endpoint
 * still returns them via the full mapper.
 */
export function mapContainerDetectionEntityToListInterface(
  d: VulnerabilityDetectionsContainer,
  explainer?: CvssExplainerService,
): ContainerVulnerabilityDetection {
  const full = mapContainerDetectionEntityToInterface(d, explainer);
  if (!full.vuln) return full;
  return {
    ...full,
    vuln: {
      ...full.vuln,
      description: '',
      references: [],
    },
  };
}
