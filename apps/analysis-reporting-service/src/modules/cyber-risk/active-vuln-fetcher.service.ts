import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';

import { ACTIVE_VULN_STATES } from './cyber-risk.constants';
import type { VulnForScoring } from './helpers/points-from-vuln';

type RawScoringRow = {
  cvssEnvironmental: string | number | null;
  cvss4: string | number | null;
  severity: string | null;
};

type RawScoringRowBatch = RawScoringRow & {
  projectId: string;
  branch?: string | null;
};

type RawScoringRowWithId = RawScoringRow & { id: string | number };

/** Detection scan-type discriminator used for the /overview breakdown. */
export type ScanType = 'SAST' | 'IAC' | 'CICD' | 'SCA' | 'CONTAINER' | 'SECRET';

/** A scoring vuln carrying the per-detection id + scan type for breakdowns. */
export type VulnForScoringWithMeta = VulnForScoring & {
  id: string;
  scanType: ScanType;
};

/**
 * Fetches the vulnerabilities that contribute to a project CybeRisk Score
 * across the 6 detection tables, in their active states. Optional `since`
 * filters to vulns discovered after a cutoff (powers the live 7-day level).
 * cvss3 is intentionally null (no per-detection cvss3 column).
 */
@Injectable()
export class ActiveVulnFetcher {
  constructor(
    @InjectRepository(SastVulnerabilityDetections)
    private readonly sastRepo: Repository<SastVulnerabilityDetections>,
    @InjectRepository(IacVulnerabilityDetections)
    private readonly iacRepo: Repository<IacVulnerabilityDetections>,
    @InjectRepository(CicdVulnerabilityDetections)
    private readonly cicdRepo: Repository<CicdVulnerabilityDetections>,
    @InjectRepository(ScaVulnerabilityDetections)
    private readonly scaRepo: Repository<ScaVulnerabilityDetections>,
    @InjectRepository(VulnerabilityDetectionsContainer)
    private readonly containerRepo: Repository<VulnerabilityDetectionsContainer>,
    @InjectRepository(SecretVulnerabilityDetections)
    private readonly secretRepo: Repository<SecretVulnerabilityDetections>,
  ) {}

  private get repos(): Repository<unknown>[] {
    return [
      this.sastRepo as Repository<unknown>,
      this.iacRepo as Repository<unknown>,
      this.cicdRepo as Repository<unknown>,
      this.scaRepo as Repository<unknown>,
      this.containerRepo as Repository<unknown>,
      this.secretRepo as Repository<unknown>,
    ];
  }

  /** The 6 detection repos paired with their scan-type discriminator. */
  private get reposByScanType(): {
    repo: Repository<unknown>;
    scanType: ScanType;
  }[] {
    return [
      { repo: this.sastRepo as Repository<unknown>, scanType: 'SAST' },
      { repo: this.iacRepo as Repository<unknown>, scanType: 'IAC' },
      { repo: this.cicdRepo as Repository<unknown>, scanType: 'CICD' },
      { repo: this.scaRepo as Repository<unknown>, scanType: 'SCA' },
      {
        repo: this.containerRepo as Repository<unknown>,
        scanType: 'CONTAINER',
      },
      { repo: this.secretRepo as Repository<unknown>, scanType: 'SECRET' },
    ];
  }

  async fetchActiveVulns(
    projectId: string,
    since?: Date,
    branches?: string[],
  ): Promise<VulnForScoring[]> {
    const states = [...ACTIVE_VULN_STATES];
    const perRepo = await Promise.all(
      this.repos.map((r) =>
        this.fetchForRepo(r, projectId, states, since, branches),
      ),
    );
    return perRepo.flat();
  }

  async fetchActiveVulnsBatch(
    projectIds: string[],
    since?: Date,
    branchesByProject?: Map<string, string[]>,
  ): Promise<Map<string, VulnForScoring[]>> {
    const out = new Map<string, VulnForScoring[]>();
    if (projectIds.length === 0) return out;
    for (const id of projectIds) out.set(id, []);
    const states = [...ACTIVE_VULN_STATES];
    const perRepo = await Promise.all(
      this.repos.map((r) =>
        this.fetchForRepoBatch(r, projectIds, states, since),
      ),
    );
    for (const rows of perRepo) {
      for (const row of rows) {
        const arr = out.get(row.projectId);
        if (!arr) continue;
        // Branch-scope per project (mirrors the persisted score) when a scoring
        // branch set is supplied: drop rows whose branch is not in the set.
        if (branchesByProject) {
          const allowed = branchesByProject.get(row.projectId);
          if (
            allowed &&
            allowed.length &&
            !allowed.includes(row.branch ?? '')
          ) {
            continue;
          }
        }
        arr.push(toVuln(row));
      }
    }
    return out;
  }

  /**
   * Like fetchActiveVulns but carries the per-detection id + scan type so the
   * /overview detail endpoint can rebuild the byScanType / topContributors
   * breakdown live from the persisted score.
   */
  async fetchActiveVulnsWithMeta(
    projectId: string,
    branches?: string[],
  ): Promise<VulnForScoringWithMeta[]> {
    const states = [...ACTIVE_VULN_STATES];
    const perRepo = await Promise.all(
      this.reposByScanType.map(({ repo, scanType }) =>
        this.fetchForRepoWithMeta(repo, scanType, projectId, states, branches),
      ),
    );
    return perRepo.flat();
  }

  private async fetchForRepoWithMeta(
    repo: Repository<unknown>,
    scanType: ScanType,
    projectId: string,
    states: string[],
    branches?: string[],
  ): Promise<VulnForScoringWithMeta[]> {
    const qb = repo
      .createQueryBuilder('v')
      .select('v.id', 'id')
      .addSelect('v.cvss4EnvironmentalScore', 'cvssEnvironmental')
      .addSelect('v.cvss4BaseScore', 'cvss4')
      .addSelect('v.currentSeverity', 'severity')
      .where('v.projectId = :projectId', { projectId })
      .andWhere('v.currentState IN (:...states)', { states });
    if (branches && branches.length)
      qb.andWhere('v.branch IN (:...branches)', { branches });
    const rows = await qb.getRawMany<RawScoringRowWithId>();
    return rows.map((row) => ({
      ...toVuln(row),
      id: String(row.id),
      scanType,
    }));
  }

  private async fetchForRepo(
    repo: Repository<unknown>,
    projectId: string,
    states: string[],
    since?: Date,
    branches?: string[],
  ): Promise<VulnForScoring[]> {
    const qb = repo
      .createQueryBuilder('v')
      .select('v.cvss4EnvironmentalScore', 'cvssEnvironmental')
      .addSelect('v.cvss4BaseScore', 'cvss4')
      .addSelect('v.currentSeverity', 'severity')
      .where('v.projectId = :projectId', { projectId })
      .andWhere('v.currentState IN (:...states)', { states });
    if (since) qb.andWhere('v.createdAt > :since', { since });
    if (branches && branches.length)
      qb.andWhere('v.branch IN (:...branches)', { branches });
    const rows = await qb.getRawMany<RawScoringRow>();
    return rows.map(toVuln);
  }

  private async fetchForRepoBatch(
    repo: Repository<unknown>,
    projectIds: string[],
    states: string[],
    since?: Date,
  ): Promise<RawScoringRowBatch[]> {
    const qb = repo
      .createQueryBuilder('v')
      .select('v.projectId', 'projectId')
      .addSelect('v.branch', 'branch')
      .addSelect('v.cvss4EnvironmentalScore', 'cvssEnvironmental')
      .addSelect('v.cvss4BaseScore', 'cvss4')
      .addSelect('v.currentSeverity', 'severity')
      .where('v.projectId IN (:...projectIds)', { projectIds })
      .andWhere('v.currentState IN (:...states)', { states });
    if (since) qb.andWhere('v.createdAt > :since', { since });
    return qb.getRawMany<RawScoringRowBatch>();
  }
}

function toVuln(row: RawScoringRow): VulnForScoring {
  return {
    cvssEnvironmental: toNumberOrNull(row.cvssEnvironmental),
    cvss4: toNumberOrNull(row.cvss4),
    cvss3: null,
    severity: normalizeSeverity(row.severity),
  };
}

function toNumberOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isNaN(n) ? null : n;
}

function normalizeSeverity(s: string | null): VulnForScoring['severity'] {
  // currentSeverity is stored with heterogeneous casing across scanners
  // (e.g. SCA stores UPPERCASE on its CVSS-less text fallback), so lowercase
  // before matching — otherwise a CVSS-less 'CRITICAL'/'HIGH' would fall to
  // null and score 0 via the severity fallback.
  switch ((s ?? '').toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    case 'none':
      return 'none';
    default:
      return null;
  }
}
