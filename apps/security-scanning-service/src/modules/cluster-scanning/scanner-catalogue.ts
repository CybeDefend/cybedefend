import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Scanner } from 'src/entities/scanner.entity';
import {
  CLUSTER_SCANNING_CONFIG,
  type ClusterScanningConfig,
  type ScannerAdapter,
} from './cluster-scanning.config';

/**
 * The Community scanner catalogue: the five
 * cybedefend-scanners images the Community cluster engine runs.
 *
 * - Community only, and never written by a migration: CommunityScannerCatalogue
 *   upserts the five rows at boot, so a cloud database never holds them.
 * - `scanner.imageName` (copied into `container.image`) is
 *   `cybedefend-scanners/<adapter>:<tag>`, without the registry: an
 *   administrator's registry name holding `container`, `agent` or `aibom`
 *   would otherwise make the scanner optional in calculateScanStatus.
 * - zizmor is a `sast` scanner whose import category is `cicd`: the
 *   scanner-type enum has no `cicd` value.
 */

export interface CatalogueEntry {
  id: string;
  adapter: ScannerAdapter;
  /** `scanner.scannerType`, and the project toggle / severities key. */
  scannerType: 'sast' | 'secret' | 'iac' | 'sca';
  /** The import category of its results. */
  category: 'sast' | 'cicd' | 'secret' | 'iac' | 'sca';
}

const entry = (e: CatalogueEntry): CatalogueEntry => Object.freeze(e);

export const COMMUNITY_SCANNER_CATALOGUE: readonly CatalogueEntry[] =
  Object.freeze([
    entry({
      id: '00000000-0000-4000-8000-0000000000c1',
      adapter: 'opengrep',
      scannerType: 'sast',
      category: 'sast',
    }),
    entry({
      id: '00000000-0000-4000-8000-0000000000c2',
      adapter: 'zizmor',
      scannerType: 'sast',
      category: 'cicd',
    }),
    entry({
      id: '00000000-0000-4000-8000-0000000000c3',
      adapter: 'gitleaks',
      scannerType: 'secret',
      category: 'secret',
    }),
    entry({
      id: '00000000-0000-4000-8000-0000000000c4',
      adapter: 'trivy-config',
      scannerType: 'iac',
      category: 'iac',
    }),
    entry({
      id: '00000000-0000-4000-8000-0000000000c5',
      adapter: 'trivy-fs',
      scannerType: 'sca',
      category: 'sca',
    }),
  ]);

const IMAGE_PREFIX = 'cybedefend-scanners/';

/** The scanner name: `cybedefend-scanners/<adapter>`. */
export function scannerName(adapter: ScannerAdapter): string {
  return `${IMAGE_PREFIX}${adapter}`;
}

/** What `scanner.imageName` and `container.image` store: no registry. */
export function storedImage(adapter: ScannerAdapter, tag: string): string {
  return `${scannerName(adapter)}:${tag}`;
}

/** What a pod pulls: the configured registry, the image, the configured tag. */
export function pullReference(
  config: ClusterScanningConfig,
  adapter: ScannerAdapter,
): string {
  return `${config.imageRegistry}/${storedImage(adapter, config.imageTag)}`;
}

/** The entries of the enabled scan types, in table order ('sast' brings opengrep and zizmor). */
export function entriesFor(enabledScanTypes: string[]): CatalogueEntry[] {
  const enabled = new Set(enabledScanTypes);
  return COMMUNITY_SCANNER_CATALOGUE.filter((e) => enabled.has(e.scannerType));
}

/**
 * The entry of an image: a stored image, or a pull reference (a registry
 * with a port or a path, a tag or a digest). Null for any other image.
 */
export function entryForImage(image: string): CatalogueEntry | null {
  // The repository path without its tag or digest; its last two segments
  // are `cybedefend-scanners/<adapter>` (a registry may add a host, a port
  // and a path before them).
  const path = image.split('@')[0];
  const slash = path.lastIndexOf('/');
  const colon = path.lastIndexOf(':');
  const repository = colon > slash ? path.slice(0, colon) : path;
  const name = repository.split('/').slice(-2).join('/');
  return (
    COMMUNITY_SCANNER_CATALOGUE.find((e) => scannerName(e.adapter) === name) ??
    null
  );
}

@Injectable()
export class CommunityScannerCatalogue {
  constructor(
    @InjectRepository(Scanner)
    private readonly scanners: Repository<Scanner>,
    @Inject(CLUSTER_SCANNING_CONFIG)
    private readonly config: ClusterScanningConfig | null,
  ) {}

  /**
   * Upserts the five rows by id (name, image, resources, pod retention), so
   * a changed tag or resource takes effect at the next boot. Import-only (no
   * configuration): writes nothing.
   */
  async seed(): Promise<void> {
    const config = this.config;
    if (!config) return;
    const keep = config.keepPods;
    const rows = COMMUNITY_SCANNER_CATALOGUE.map((e) => {
      const resources = config.resources[e.adapter];
      return {
        id: e.id,
        name: scannerName(e.adapter),
        imageName: storedImage(e.adapter, config.imageTag),
        enabled: true,
        scannerType: e.scannerType,
        cpuRequest: resources.cpuRequest,
        cpuLimit: resources.cpuLimit,
        memoryRequest: resources.memoryRequest,
        memoryLimit: resources.memoryLimit,
        deletePodsOnFinish: !keep,
        deletePodsOnError: !keep,
      };
    });
    await this.scanners.upsert(rows, ['id']);
  }
}
