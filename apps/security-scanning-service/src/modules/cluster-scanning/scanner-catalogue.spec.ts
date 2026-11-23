import type { Repository } from 'typeorm';
import type { Scanner } from 'src/entities/scanner.entity';
import {
  readClusterScanningConfig,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import {
  COMMUNITY_SCANNER_CATALOGUE,
  CommunityScannerCatalogue,
  entriesFor,
  entryForImage,
  pullReference,
  storedImage,
} from './scanner-catalogue';

/**
 * Community scans on a connected Kubernetes cluster:
 * the five cybedefend-scanners images of the Community engine. The catalogue is
 * Community-only and is never written by a migration (the seed upserts it at
 * boot). `container.image` stores `cybedefend-scanners/<adapter>:<tag>` without
 * the registry, so an administrator's registry name that contains
 * `container`, `agent` or `aibom` never makes a scanner optional
 * (calculateScanStatus). zizmor is a `sast` scanner whose import category is
 * `cicd`: the scanner-type enum gets no `cicd` value.
 */
const config = (env: NodeJS.ProcessEnv = {}): ClusterScanningConfig =>
  readClusterScanningConfig({
    CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/k',
    CYBEDEFEND_SCANNER_NAMESPACE: 'scans',
    FRONTEND_URL: 'https://a.example',
    ...env,
  });

describe('COMMUNITY_SCANNER_CATALOGUE', () => {
  it('holds the five rows of the design, in table order, with fixed ids', () => {
    expect(
      COMMUNITY_SCANNER_CATALOGUE.map((e) => [
        e.id,
        e.adapter,
        e.scannerType,
        e.category,
      ]),
    ).toEqual([
      ['00000000-0000-4000-8000-0000000000c1', 'opengrep', 'sast', 'sast'],
      ['00000000-0000-4000-8000-0000000000c2', 'zizmor', 'sast', 'cicd'],
      ['00000000-0000-4000-8000-0000000000c3', 'gitleaks', 'secret', 'secret'],
      ['00000000-0000-4000-8000-0000000000c4', 'trivy-config', 'iac', 'iac'],
      ['00000000-0000-4000-8000-0000000000c5', 'trivy-fs', 'sca', 'sca'],
    ]);
  });

  it('no stored image or name holds container, agent or aibom', () => {
    expect(COMMUNITY_SCANNER_CATALOGUE).toHaveLength(5);
    for (const e of COMMUNITY_SCANNER_CATALOGUE) {
      expect(storedImage(e.adapter, '1.0.0')).not.toMatch(
        /container|agent|aibom/,
      );
      expect(`cybedefend-scanners/${e.adapter}`).not.toMatch(
        /container|agent|aibom/,
      );
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(COMMUNITY_SCANNER_CATALOGUE)).toBe(true);
  });
});

describe('storedImage and pullReference', () => {
  it('stores the image without the registry', () => {
    expect(storedImage('trivy-fs', '1.0.0')).toBe(
      'cybedefend-scanners/trivy-fs:1.0.0',
    );
  });

  it('pulls from the configured registry and tag', () => {
    expect(pullReference(config(), 'opengrep')).toBe(
      'ghcr.io/cybedefend/cybedefend-scanners/opengrep:1.0.0',
    );
    expect(
      pullReference(
        config({
          CYBEDEFEND_SCANNER_IMAGE_REGISTRY: 'registry.local:5000/agent-images',
          CYBEDEFEND_SCANNER_IMAGE_TAG: '1.2.0',
        }),
        'gitleaks',
      ),
    ).toBe(
      'registry.local:5000/agent-images/cybedefend-scanners/gitleaks:1.2.0',
    );
  });
});

describe('entriesFor', () => {
  it('sast brings opengrep and zizmor (cicd category)', () => {
    expect(entriesFor(['sast']).map((e) => [e.adapter, e.category])).toEqual([
      ['opengrep', 'sast'],
      ['zizmor', 'cicd'],
    ]);
  });

  it('no enabled type: no entry', () => expect(entriesFor([])).toEqual([]));

  it('every type: the five, in table order', () => {
    expect(
      entriesFor(['sca', 'iac', 'secret', 'sast']).map((e) => e.adapter),
    ).toEqual(['opengrep', 'zizmor', 'gitleaks', 'trivy-config', 'trivy-fs']);
  });

  it('a type the catalogue has no image for brings nothing', () => {
    expect(entriesFor(['container', 'aibom', 'cicd'])).toEqual([]);
  });
});

describe('entryForImage', () => {
  it('finds the entry of a stored image', () => {
    expect(entryForImage('cybedefend-scanners/zizmor:1.0.0')?.adapter).toBe(
      'zizmor',
    );
    expect(
      entryForImage('cybedefend-scanners/trivy-config:2.0.0')?.adapter,
    ).toBe('trivy-config');
  });

  it('finds the entry of a pull reference, a port registry or a digest', () => {
    expect(
      entryForImage('registry.local:5000/x/cybedefend-scanners/gitleaks:1.0.0')
        ?.adapter,
    ).toBe('gitleaks');
    expect(
      entryForImage(`cybedefend-scanners/opengrep@sha256:${'a'.repeat(64)}`)
        ?.adapter,
    ).toBe('opengrep');
  });

  it('a cloud scanner image or an unknown adapter is null', () => {
    expect(entryForImage('scanlink-sast-iac')).toBeNull();
    expect(entryForImage('cybedefend-scanners/semgrep:1.0.0')).toBeNull();
    expect(entryForImage('cybedefend-scanners/trivy:1.0.0')).toBeNull();
    expect(entryForImage('')).toBeNull();
  });

  it('an adapter name outside the cybedefend-scanners repository is null', () => {
    expect(entryForImage('opengrep:1.0.0')).toBeNull();
    expect(entryForImage('ghcr.io/someone/opengrep:1.0.0')).toBeNull();
    expect(entryForImage('ghcr.io/x/other-scanners/gitleaks')).toBeNull();
  });
});

describe('CommunityScannerCatalogue.seed', () => {
  const repository = () => {
    const upsert = jest.fn().mockResolvedValue({});
    return {
      upsert,
      repo: { upsert } as unknown as Repository<Scanner>,
    };
  };

  it('upserts the five rows by id, with the resources of the config', async () => {
    const { upsert, repo } = repository();
    const cfg = config({
      CYBEDEFEND_SCANNER_RESOURCES: JSON.stringify({
        opengrep: { memoryLimit: '4Gi' },
      }),
    });

    await new CommunityScannerCatalogue(repo, cfg).seed();

    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, conflict] = upsert.mock.calls[0];
    expect(conflict).toEqual(['id']);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      id: '00000000-0000-4000-8000-0000000000c1',
      name: 'cybedefend-scanners/opengrep',
      imageName: 'cybedefend-scanners/opengrep:1.0.0',
      enabled: true,
      scannerType: 'sast',
      cpuRequest: '500m',
      cpuLimit: '1',
      memoryRequest: '1Gi',
      memoryLimit: '4Gi',
      deletePodsOnFinish: true,
      deletePodsOnError: true,
    });
    expect(rows[1]).toMatchObject({
      name: 'cybedefend-scanners/zizmor',
      imageName: 'cybedefend-scanners/zizmor:1.0.0',
      scannerType: 'sast',
      cpuRequest: '100m',
      memoryLimit: '512Mi',
    });
  });

  it('keepPods keeps the pods on finish and on error', async () => {
    const { upsert, repo } = repository();

    await new CommunityScannerCatalogue(
      repo,
      config({ CYBEDEFEND_SCANNER_KEEP_PODS: 'true' }),
    ).seed();

    for (const row of upsert.mock.calls[0][0]) {
      expect(row.deletePodsOnFinish).toBe(false);
      expect(row.deletePodsOnError).toBe(false);
    }
  });

  it('stores the configured tag, never the registry', async () => {
    const { upsert, repo } = repository();

    await new CommunityScannerCatalogue(
      repo,
      config({
        CYBEDEFEND_SCANNER_IMAGE_REGISTRY: 'registry.local/container-agent',
        CYBEDEFEND_SCANNER_IMAGE_TAG: '1.4.2',
      }),
    ).seed();

    expect(upsert.mock.calls[0][0].map((r) => r.imageName)).toEqual([
      'cybedefend-scanners/opengrep:1.4.2',
      'cybedefend-scanners/zizmor:1.4.2',
      'cybedefend-scanners/gitleaks:1.4.2',
      'cybedefend-scanners/trivy-config:1.4.2',
      'cybedefend-scanners/trivy-fs:1.4.2',
    ]);
  });

  it('import-only (no config): writes nothing', async () => {
    const { upsert, repo } = repository();

    await new CommunityScannerCatalogue(repo, null).seed();

    expect(upsert).not.toHaveBeenCalled();
  });
});
