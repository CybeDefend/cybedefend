import {
  mapContainerDetectionEntityToInterface,
  mapContainerDetectionEntityToListInterface,
} from './container.mapper';

/**
 * Container list-payload budget guard.
 *
 * Sibling of `sca.list-payload.spec.ts`. We size a deliberately-fat OSV-backed
 * container detection (long `details` markdown body + many `references`) and
 * check that the list-mode mapper drops it under the gRPC ceiling so a full
 * page (≤ 10 detections) cannot grow past the 50 MB limit.
 */
function makeFatContainerDetection() {
  const references = Array.from({ length: 400 }, (_, i) => ({
    id: `ref-${i}`,
    type: 'ADVISORY',
    url: `https://example.test/advisory-${i}-${'x'.repeat(200)}`,
  }));

  return {
    id: 'det-c-fat',
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
      // Long OSV markdown body — this is what blows up payloads on real
      // CVEs like Log4Shell when streamed at list-mode cardinality.
      details: 'A VERY LONG OSV DETAILS BODY '.repeat(8000),
      modifiedAt: new Date('2024-12-01T00:00:00Z'),
      publishedAt: new Date('2024-11-01T00:00:00Z'),
      references,
      severities: [{ id: 's1', type: 'CVSS_V3', score: '10' }],
      affected: [],
      aliases: [{ id: 'a1', alias: 'CVE-2024-1234' }],
      databaseSpecific: { cwe_ids: ['CWE-119'], severity: 'CRITICAL' },
    },
  } as any;
}

describe('Container list payload size guard', () => {
  it('full mapper payload demonstrates the bloat (sanity check, > 200 KB)', () => {
    const det = makeFatContainerDetection();
    const full = mapContainerDetectionEntityToInterface(det);
    const sizeKb = JSON.stringify(full).length / 1024;
    expect(sizeKb).toBeGreaterThan(200);
  });

  it('list mapper payload stays well under the gRPC budget per detection', () => {
    const det = makeFatContainerDetection();
    const light = mapContainerDetectionEntityToListInterface(det);
    const sizeKb = JSON.stringify(light).length / 1024;
    // 10 detections per page × 200 KB each = 2 MB, well under the 50 MB
    // gRPC ceiling we want to defend against.
    expect(sizeKb).toBeLessThan(200);
  });

  it('list mapper still preserves the critical UI signals (cve + fixedVersion + severity)', () => {
    const det = makeFatContainerDetection();
    const light = mapContainerDetectionEntityToListInterface(det);
    expect(light.vuln?.vulnerabilityId).toBe('CVE-2024-1234');
    expect(light.vuln?.fixedVersion).toBe('1.1.1w');
    expect(light.currentSeverity).toBe('critical');
    expect(light.package?.name).toBe('openssl');
  });
});
