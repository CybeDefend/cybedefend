import type {
  ContainerVulnerability,
  ScanAddContainerResultRequest,
} from '@grpc/analysis-reporting/result';
import type { VulnerabilityOsv } from '../../entities/osv';
import type { ContainerDetectedImage } from '../../entities/container-detected-image.entity';
import type { ContainerDetectedPackage } from '../../entities/container-detected-package.entity';
import type { ContainerDetectionSource } from '../../entities/container_vulnerability_detections.entity';

/**
 * Extension token: matches a container batch's
 * package inventory against an advisory mirror, after the scanner's own
 * findings. Only an ee module supplies it (the OSV mirror); when the
 * token is absent — the Community Edition — ContainerService stores the
 * scanner's findings only.
 */
export const CONTAINER_INVENTORY_MATCHER = 'CONTAINER_INVENTORY_MATCHER';

/** The detection writes of ContainerService the matcher goes through. */
export interface ContainerAdvisoryWriter {
  findOrCreateOsvStub(advisoryId: string): Promise<VulnerabilityOsv>;
  upsertDetection(
    projectId: string,
    image: ContainerDetectedImage,
    pkg: ContainerDetectedPackage,
    osvStub: VulnerabilityOsv,
    dto: ContainerVulnerability,
    branch: string | undefined,
    source: ContainerDetectionSource,
  ): Promise<unknown>;
  highestSeverityOf(osv: VulnerabilityOsv): string;
}

export interface ContainerInventoryMatcher {
  /** Writes, through `writer`, the advisories the scanner did not report; returns how many. Never throws for one package. */
  matchInventory(
    input: {
      projectId: string;
      image: ContainerDetectedImage;
      results: ScanAddContainerResultRequest['results'];
      os: ScanAddContainerResultRequest['os'] | undefined;
      branch?: string;
    },
    writer: ContainerAdvisoryWriter,
  ): Promise<number>;
}
