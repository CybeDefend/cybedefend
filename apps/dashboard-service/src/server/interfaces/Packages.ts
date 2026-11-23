/**
 * =========== PACKAGES SCA ===============
 */

export interface ImportLocation {
  file: string;
  line: number;
  content?: string;
}

export interface ScaDetectedPackage {
  id: string;
  projectId: string;
  packageName: string;
  packageVersion: string;
  fileName: string;
  isTransitive: boolean;
  isDev: boolean;
  ecosystem: string;
  createdAt: string;
  path: string[];
  updatedAt: string;
  dependencyInfoAvailable?: boolean;
  reachability?: string;
  importLocations?: ImportLocation[];
  licenses?: string[];
}

export interface PaginatedScaPackagesResults {
  projectId: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  packages: ScaDetectedPackage[];
}

/**
 * =========== LICENSE SUMMARY ===============
 */

export interface LicenseSummaryItem {
  spdxId: string;
  name: string;
  category: 'PERMISSIVE' | 'WEAK_COPYLEFT' | 'STRONG_COPYLEFT' | 'UNKNOWN';
  risk: 'NONE' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  riskDescription: string;
  count: number;
}

export interface LicenseSummaryResponse {
  projectId: string;
  totalPackages: number;
  packagesWithLicenses: number;
  packagesWithoutLicenses: number;
  permissiveCount: number;
  weakCopyleftCount: number;
  strongCopyleftCount: number;
  unknownCount: number;
  ignoredCount: number;
  licenses: LicenseSummaryItem[];
}

/**
 * =========== LICENSE DETAIL ===============
 */

export interface LicensePackageItem {
  id: string;
  packageName: string;
  packageVersion: string;
  ecosystem: string;
  licenses: string[];
  isTransitive: boolean;
  isDev: boolean;
  isLicenseIgnored: boolean;
}

export interface LicenseDetailResponse {
  spdxId: string;
  name: string;
  category: 'PERMISSIVE' | 'WEAK_COPYLEFT' | 'STRONG_COPYLEFT' | 'UNKNOWN';
  risk: 'NONE' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  riskDescription: string;
  totalCount: number;
  packages: LicensePackageItem[];
}

// A single container image, enriched
export interface ContainerImage {
  id: string;
  projectId: string;
  artifactName: string;
  osFamily: string;
  osName: string;
  /**
   * The base OS is end-of-support-life. The distribution no longer
   * publishes advisories, so 0 vulnerabilities means "detection impossible".
   */
  osEosl: boolean;
  createdAt: string;
  updatedAt: string;
  vulnCounts: VulnerabilityCounts;
  branch?: string;
}

export interface ContainerDetectedPackage {
  id: string;
  projectId: string;
  packageName: string;
  packageVersion: string;
  ecosystem?: string;
  arch: string;
  srcName: string;
  srcVersion: string;
  target: string;
  class: string;
  licenses: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedContainerPackagesResults {
  projectId: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  packages: ContainerDetectedPackage[];
}
/**
 * =========== GROUPED CONTAINER IMAGES ===============
 */

/** A single tag within a grouped container image */
export interface ContainerImageTag {
  /** Original image entity ID */
  id: string;
  /**
   * Extracted tag from artifact_name (e.g., "v1.0.0", "latest"). EMPTY when the
   * image was scanned by digest only: such an artifact carries no tag, so the
   * row is labelled and addressed with its `digest` instead.
   */
  tag: string;
  /**
   * Full digest extracted from artifact_name (e.g. "sha256:<64 hex>"), empty
   * when the image was addressed by tag. Rebuild the reference with
   * `buildImageReference` — a digest only attaches with '@', never ':'.
   */
  digest?: string;
  /** This tag runs an end-of-support-life base OS */
  osEosl: boolean;
  scanId: string;
  createdAt: string;
  updatedAt: string;
  /** Vulnerability counts for this specific tag */
  vulnCounts: VulnerabilityCounts | undefined;
}

/** Grouped container image by repository name (without tag) */
export interface GroupedContainerImage {
  /** Repository name without tag (e.g., "registry.gitlab.com/group/project") */
  repositoryName: string;
  projectId: string;
  osFamily: string;
  osName: string;
  /** True when ANY tag of the repository runs an end-of-life base OS */
  osEosl: boolean;
  branch: string;
  /** Number of different tags for this image */
  tagCount: number;
  /** All tags for this repository */
  tags: ContainerImageTag[];
  /** Total vulnerability counts across all tags */
  aggregatedVulnCounts: VulnerabilityCounts | undefined;
  /** Most recent scan date across all tags */
  latestScanAt: string;
}

/** Response for grouped container images endpoint */
export interface PaginatedGroupedContainerImagesResults {
  projectName: string;
  groupedImages: GroupedContainerImage[];
  /** Total number of unique repositories */
  totalRepositories: number;
  /** Total number of tags across all repositories */
  totalTags: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}