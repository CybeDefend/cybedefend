import {
  mapContainerDetectionEntityToInterface,
  mapContainerDetectionEntityToListInterface,
} from './container.mapper';

function makeFatContainerDetection() {
  return {
    id: 'det-c',
    projectId: 'p1',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
    currentState: 'to_verify',
    currentSeverity: 'critical',
    currentPriority: 'critical_urgent',
    branch: 'main',
    scoringSource: 'static',
    historyItems: [],
    autofixRecords: [],
    vulnerabilityIdentifier: 'CVE-2024-1234',
    fixedVersion: '1.1.1w',
    detectedPackage: {
      id: 'pkg-c',
      projectId: 'p1',
      packageName: 'openssl',
      packageVersion: '1.1.1',
      srcName: 'openssl-src',
      srcVersion: '1.1.1',
      arch: 'x86_64',
      digest: 'sha256:deadbeef',
      licenses: '[]',
      dependsOn: [],
      target: 'alpine:3.18 (alpine 3.18.0)',
      class: 'os-pkgs',
    },
    detectedImage: {
      id: 'img-c',
      name: 'alpine',
      tag: '3.18',
    },
    vulnerability: {
      id: 'CVE-2024-1234',
      summary: 'Buffer overflow in openssl',
      details: 'A VERY LONG OSV DETAILS BODY '.repeat(2000),
      modifiedAt: new Date('2024-12-01T00:00:00Z'),
      publishedAt: new Date('2024-11-01T00:00:00Z'),
      references: Array.from({ length: 40 }, (_, i) => ({
        id: `r-${i}`,
        url: `https://example.test/cve-${i}-${'p'.repeat(200)}`,
        type: 'WEB',
      })),
      severities: [],
      affected: [],
      aliases: [],
      databaseSpecific: null,
    },
  } as any;
}

describe('mapContainerDetectionEntityToInterface — installed-aware recommended fix', () => {
  it('recommends only the smallest fix above the installed version for lang-pkgs (no downgrade)', () => {
    const det = makeFatContainerDetection();
    det.detectedPackage.class = 'lang-pkgs';
    det.detectedPackage.packageName = 'minimatch';
    det.detectedPackage.packageVersion = '9.0.9';
    det.fixedVersion =
      '10.2.1, 9.0.6, 8.0.5, 7.4.7, 6.2.1, 5.1.7, 4.2.4, 3.1.3';

    const out = mapContainerDetectionEntityToInterface(det);

    expect(out.vuln?.fixedVersion).toBe('10.2.1');
    expect(out.fixedVersion).toBe('10.2.1');
  });

  it('returns no fix when the lang-pkg install is already past every listed fix', () => {
    const det = makeFatContainerDetection();
    det.detectedPackage.class = 'lang-pkgs';
    det.detectedPackage.packageVersion = '9.0.9';
    det.fixedVersion = '9.0.6, 8.0.5';

    const out = mapContainerDetectionEntityToInterface(det);

    expect(out.vuln?.fixedVersion).toBe('');
  });

  it('leaves OS-package fix versions untouched (non-semver, not lang-pkgs)', () => {
    const det = makeFatContainerDetection(); // class os-pkgs, fixedVersion '1.1.1w'
    const out = mapContainerDetectionEntityToInterface(det);
    expect(out.vuln?.fixedVersion).toBe('1.1.1w');
  });
});

describe('mapContainerDetectionEntityToInterface — legacy CVSS v3 exposure', () => {
  it('exposes the persisted cvss_score on the detection (SCA parity)', () => {
    const det = makeFatContainerDetection();
    det.cvssScore = 9.8;
    const out = mapContainerDetectionEntityToInterface(det);
    expect(out.cvssScore).toBe(9.8);
  });

  it('falls back to the OSV-computed v3 score when no persisted score', () => {
    const det = makeFatContainerDetection();
    det.cvssScore = null;
    det.vulnerability.severities = [
      {
        type: 'CVSS_V3',
        score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      },
    ];
    const out = mapContainerDetectionEntityToInterface(det);
    expect(out.cvssScore).toBeGreaterThan(0);
    expect(out.cvssScore).toBe(out.vuln?.cvss?.['nvd']?.v3Score);
  });

  it('leaves cvssScore undefined when nothing is available', () => {
    const det = makeFatContainerDetection();
    det.cvssScore = null;
    const out = mapContainerDetectionEntityToInterface(det);
    expect(out.cvssScore).toBeUndefined();
  });
});

describe('mapContainerDetectionEntityToListInterface', () => {
  it('blanks out description (= OSV details) and references', () => {
    const det = makeFatContainerDetection();
    const out = mapContainerDetectionEntityToListInterface(det);
    expect(out.vuln?.description).toBe('');
    expect(out.vuln?.references).toEqual([]);
  });

  it('preserves summary / id / severity used by the dashboard list table', () => {
    const det = makeFatContainerDetection();
    const out = mapContainerDetectionEntityToListInterface(det);
    expect(out.vuln?.vulnerabilityId).toBe('CVE-2024-1234');
    expect(out.vuln?.title).toBe('Buffer overflow in openssl');
    expect(out.currentSeverity).toBe('critical');
    expect(out.package?.name).toBe('openssl');
  });

  it('stays well under the gRPC budget per detection (< 30 KB)', () => {
    const det = makeFatContainerDetection();
    const light = mapContainerDetectionEntityToListInterface(det);
    const sizeKb = JSON.stringify(light).length / 1024;
    expect(sizeKb).toBeLessThan(30);
  });

  it('full mapper still produces the bloated payload (sanity check, > 60 KB)', () => {
    const det = makeFatContainerDetection();
    const full = mapContainerDetectionEntityToInterface(det);
    const sizeKb = JSON.stringify(full).length / 1024;
    expect(sizeKb).toBeGreaterThan(60);
  });
});

describe('mapContainerDetectionEntityToInterface — detection source', () => {
  it('exposes an osv-matched detection as such', () => {
    const fat = { ...makeFatContainerDetection(), detectionSource: 'osv' };
    expect(mapContainerDetectionEntityToInterface(fat).detectionSource).toBe(
      'osv',
    );
    expect(
      mapContainerDetectionEntityToListInterface(fat).detectionSource,
    ).toBe('osv');
  });

  it('defaults a legacy row (column absent) to scanner', () => {
    const fat = makeFatContainerDetection();
    delete fat.detectionSource;
    expect(mapContainerDetectionEntityToInterface(fat).detectionSource).toBe(
      'scanner',
    );
  });
});
