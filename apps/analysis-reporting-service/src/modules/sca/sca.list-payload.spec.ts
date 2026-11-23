import {
  mapScaDetectionEntityToListInterface,
  mapScaDetectionEntityToInterface,
} from './sca.mapper';

function makeFatLog4ShellDetection() {
  const events = Array.from({ length: 200 }, (_, k) => ({
    id: `evt-${k}`,
    introduced: k % 2 === 0 ? `2.${k}.0` : '',
    fixed: k % 2 === 1 ? `2.${k}.1` : '',
  }));
  const ranges = Array.from({ length: 20 }, (_, j) => ({
    id: `rng-${j}`,
    type: 'SEMVER',
    events,
  }));
  const affected = Array.from({ length: 50 }, (_, i) => ({
    id: `aff-${i}`,
    ecosystem: 'maven',
    packageName: `org.apache.logging.log4j:log4j-core-${i}`,
    ranges,
  }));
  const references = Array.from({ length: 400 }, (_, i) => ({
    id: `ref-${i}`,
    type: 'ADVISORY',
    url: `https://example.test/advisory-${i}-${'x'.repeat(200)}`,
  }));

  return {
    id: 'det-fat',
    projectId: 'p1',
    createdAt: new Date('2024-12-10T00:00:00Z'),
    updatedAt: new Date('2024-12-11T00:00:00Z'),
    currentState: 'to_verify',
    currentSeverity: 'critical',
    currentPriority: 'critical_urgent',
    currentCVSS: 10.0,
    branch: 'main',
    scoringSource: 'static',
    scaDetectedPackage: {
      id: 'pkg-fat',
      projectId: 'p1',
      packageName: 'log4j-core',
      packageVersion: '2.14.0',
      fileName: 'pom.xml',
      ecosystem: 'maven',
      isTransitive: false,
      isDev: false,
      path: ['pom.xml'],
      importLocations: [],
      licenses: ['Apache-2.0'],
    },
    vulnerability: {
      id: 'GHSA-jfh8-c2jp-5v3q',
      internalId: 'osv-log4shell',
      summary: 'Log4Shell',
      details: 'Lengthy markdown body — '.repeat(8000),
      schemaVersion: '1.4.0',
      modifiedAt: new Date('2022-01-01T00:00:00Z'),
      publishedAt: new Date('2021-12-10T00:00:00Z'),
      createdAt: new Date('2021-12-10T00:00:00Z'),
      updatedAt: new Date('2022-01-01T00:00:00Z'),
      databaseSpecific: { cwe_ids: ['CWE-502'], severity: 'CRITICAL' },
      aliases: [{ id: 'a1', alias: 'CVE-2021-44228' }],
      severities: [{ id: 's1', type: 'CVSS_V3', score: '10' }],
      references,
      affected,
    },
    historyItems: [],
    scaAutofixRecords: [],
  } as any;
}

describe('SCA list payload size guard', () => {
  it('full mapper payload demonstrates the bloat (sanity check, > 200 KB)', () => {
    const det = makeFatLog4ShellDetection();
    const full = mapScaDetectionEntityToInterface(det);
    const sizeKb = JSON.stringify(full).length / 1024;
    expect(sizeKb).toBeGreaterThan(200);
  });

  it('list mapper payload stays well under the gRPC budget per detection', () => {
    const det = makeFatLog4ShellDetection();
    const light = mapScaDetectionEntityToListInterface(det, {
      hasFix: true,
      fixedVersion: '2.17.0',
    });
    const sizeKb = JSON.stringify(light).length / 1024;
    // 10 vulns per page × 200 KB each = 2 MB, well under 50 MB.
    expect(sizeKb).toBeLessThan(200);
  });

  it('list mapper still preserves the critical UI signal (fixAvailable + cve)', () => {
    const det = makeFatLog4ShellDetection();
    const light = mapScaDetectionEntityToListInterface(det, {
      hasFix: true,
      fixedVersion: '2.17.0',
    });
    expect(light.metadata?.cve).toBe('CVE-2021-44228');
    expect(light.metadata?.packages?.[0]?.fixAvailable).toBe(true);
  });
});
