import {
  mapScaDetectionEntityToInterface,
  mapScaDetectionEntityToListInterface,
  mapVulnerabilityScaEntityToListMetadata,
} from './sca.mapper';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';

function makeDetection(
  overrides: Partial<ScaVulnerabilityDetections> = {},
): ScaVulnerabilityDetections {
  return {
    id: 'det-1',
    projectId: 'proj-1',
    branch: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    timeToFix: '',
    currentState: 'to_verify',
    currentSeverity: 'high',
    currentPriority: 'normal',
    currentCVSS: 0,
    cvss4Vector: null,
    cvss4BaseScore: null,
    cvss4EnvironmentalScore: null,
    epssScore: null,
    epssPercentile: null,
    epssRefreshedAt: null,
    exploitabilityVerdict: null,
    exploitabilityScore: null,
    exploitabilityReason: null,
    exploitabilitySource: null,
    exploitabilityUpdatedAt: null,
    scoringSource: 'static',
    priorityManualOverride: false,
    scaDetectedPackage: undefined as any,
    vulnerability: undefined as any,
    scaAutofixRecords: [],
    historyItems: [],
    ...overrides,
  } as any;
}

describe('mapScaDetectionEntityToInterface — cvssScore mapping', () => {
  it('should include cvss4EnvironmentalVector in the SCA mapping', () => {
    const det = makeDetection({
      cvss4Vector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
      cvss4EnvironmentalVector:
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/MSC:H',
      cvss4BaseScore: 9.3,
      cvss4EnvironmentalScore: 9.7,
      currentCVSS: 9.3,
    });

    const result = mapScaDetectionEntityToInterface(det);

    expect(result.cvss4EnvironmentalVector).toBe(det.cvss4EnvironmentalVector);
  });

  it('uses persisted currentCVSS column when no OSV relation is loaded', () => {
    const det = makeDetection({
      currentCVSS: 8.5,
      vulnerability: undefined as any,
    });

    const result = mapScaDetectionEntityToInterface(det);

    expect(result.cvssScore).toBe(8.5);
  });

  it('falls back to OSV severities when currentCVSS column is 0 but relation is loaded', () => {
    const det = makeDetection({
      currentCVSS: 0,
      vulnerability: {
        id: 'OSV-FAKE-1',
        aliases: [],
        severities: [
          {
            id: 's1',
            type: 'CVSS_V3',
            score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          },
        ],
        affected: [],
        references: [],
        databaseSpecific: {},
      } as any,
    });

    const result = mapScaDetectionEntityToInterface(det);

    // calculateOsvCvssScore parses the CVSS_V3 vector to its 9.8 numeric score
    expect(result.cvssScore).toBeGreaterThan(9);
  });

  it('prefers currentCVSS over OSV-computed score when both are available', () => {
    const det = makeDetection({
      currentCVSS: 9.1,
      vulnerability: {
        id: 'OSV-FAKE-2',
        aliases: [],
        severities: [
          {
            id: 's1',
            type: 'CVSS_V3',
            score: 'CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N',
          },
        ],
        affected: [],
        references: [],
        databaseSpecific: {},
      } as any,
    });

    const result = mapScaDetectionEntityToInterface(det);

    expect(result.cvssScore).toBe(9.1);
  });

  it('returns 0 when neither currentCVSS nor OSV relation is available', () => {
    const det = makeDetection({
      currentCVSS: 0,
      vulnerability: undefined as any,
    });

    const result = mapScaDetectionEntityToInterface(det);

    expect(result.cvssScore).toBe(0);
  });
});

describe('mapScaDetectionEntityToInterface — currentSeverity resolution', () => {
  it('returns effectiveSeverity when present', () => {
    const det = makeDetection({
      currentSeverity: 'high',
      effectiveSeverity: 'critical',
    } as any);

    const result = mapScaDetectionEntityToInterface(det);

    expect(result.base.currentSeverity).toBe('critical');
  });

  it('falls back to currentSeverity when effectiveSeverity is null', () => {
    const det = makeDetection({
      currentSeverity: 'high',
      effectiveSeverity: null,
    } as any);

    const result = mapScaDetectionEntityToInterface(det);

    expect(result.base.currentSeverity).toBe('high');
  });
});

// hasCybeAnalysis keys off the 'system' sentinel userId. A history
// row attributed to a real human must NOT flip it to true.
describe('mapScaDetectionEntityToInterface — hasCybeAnalysis attribution', () => {
  it('is true when a history item is attributed to the system sentinel', () => {
    const det = makeDetection({
      historyItems: [{ type: 'exploitability_change', userId: 'system' }],
    } as any);

    const result = mapScaDetectionEntityToInterface(det);

    expect(result.hasCybeAnalysis).toBe(true);
  });

  it('is false when the only history item is a human-attributed priority_change', () => {
    const det = makeDetection({
      historyItems: [{ type: 'priority_change', userId: 'human-13' }],
    } as any);

    const result = mapScaDetectionEntityToInterface(det);

    expect(result.hasCybeAnalysis).toBe(false);
  });
});

describe('isMalware threading', () => {
  it('detail mapper surfaces isMalware=true for a malware detection', () => {
    const out = mapScaDetectionEntityToInterface(
      makeDetection({ isMalware: true } as any),
    );
    expect(out.isMalware).toBe(true);
  });

  it('detail mapper surfaces isMalware=false for a normal detection', () => {
    const out = mapScaDetectionEntityToInterface(
      makeDetection({ isMalware: false } as any),
    );
    expect(out.isMalware).toBe(false);
  });

  it('list mapper surfaces isMalware for a malware detection', () => {
    const out = mapScaDetectionEntityToListInterface(
      makeDetection({ isMalware: true } as any),
      { hasFix: false, fixedVersion: '' },
    );
    expect(out.isMalware).toBe(true);
  });
});

describe('mapVulnerabilityScaEntityToListMetadata', () => {
  const baseOsv = {
    id: 'GHSA-xxxx-yyyy',
    internalId: 'osv-1',
    summary: 'Prototype pollution in lodash',
    details: 'A VERY LONG MARKDOWN BODY — repeated 1000 times '.repeat(1000),
    schemaVersion: '1.0.0',
    modifiedAt: new Date('2025-01-01T00:00:00Z'),
    publishedAt: new Date('2024-12-01T00:00:00Z'),
    createdAt: new Date('2024-11-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
    databaseSpecific: { cwe_ids: ['CWE-1321'], severity: 'HIGH' },
    aliases: [{ id: 'a1', alias: 'CVE-2024-0001' }],
    severities: [{ id: 's1', type: 'CVSS_V3', score: '7.5' }],
    references: [
      { id: 'r1', type: 'ADVISORY', url: 'https://example.test/advisory' },
    ],
    affected: [],
  } as any;

  it('drops aliases / severities / references / details so the list payload stays small', () => {
    const out = mapVulnerabilityScaEntityToListMetadata(baseOsv, {
      packageName: 'lodash',
      ecosystem: 'npm',
      hasFix: true,
      fixedVersion: '4.17.21',
    });

    expect(out.aliases).toEqual([]);
    expect(out.severities).toEqual([]);
    expect(out.references).toEqual([]);
    expect(out.details).toBe('');
  });

  it('preserves identity / summary / cwes / dates and extracts cve from aliases or id', () => {
    const out = mapVulnerabilityScaEntityToListMetadata(baseOsv, {
      packageName: 'lodash',
      ecosystem: 'npm',
      hasFix: false,
      fixedVersion: '',
    });

    expect(out.id).toBe('GHSA-xxxx-yyyy');
    expect(out.internalId).toBe('osv-1');
    expect(out.ghsaId).toBe('GHSA-xxxx-yyyy');
    expect(out.cve).toBe('CVE-2024-0001');
    expect(out.summary).toBe('Prototype pollution in lodash');
    expect(out.cwes).toEqual([{ id: 'CWE-1321', cweId: 'CWE-1321' }]);
    expect(out.severityGh).toBe('HIGH');
    expect(out.publishedAt).toBe('2024-12-01T00:00:00.000Z');
    expect(out.modifiedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('builds a single-package summary entry from the provided detection package info', () => {
    const out = mapVulnerabilityScaEntityToListMetadata(baseOsv, {
      packageName: 'lodash',
      ecosystem: 'npm',
      hasFix: true,
      fixedVersion: '4.17.21',
    });

    expect(out.packages).toEqual([
      {
        id: '',
        ecosystem: 'npm',
        packageName: 'lodash',
        introduced: '0',
        fixed: '4.17.21',
        fixAvailable: true,
      },
    ]);
  });

  it('returns an empty packages array when ecosystem+packageName are missing', () => {
    const out = mapVulnerabilityScaEntityToListMetadata(baseOsv, {
      packageName: '',
      ecosystem: '',
      hasFix: false,
      fixedVersion: '',
    });
    expect(out.packages).toEqual([]);
  });

  it('handles missing aliases (uses GHSA from id) and missing databaseSpecific (no cwes)', () => {
    const osv = {
      ...baseOsv,
      aliases: [],
      databaseSpecific: {},
    };
    const out = mapVulnerabilityScaEntityToListMetadata(osv, {
      packageName: 'lodash',
      ecosystem: 'npm',
      hasFix: false,
      fixedVersion: '',
    });
    expect(out.cve).toBe('');
    expect(out.ghsaId).toBe('GHSA-xxxx-yyyy');
    expect(out.cwes).toEqual([]);
    expect(out.severityGh).toBe('');
  });

  it('uses the cveHint when osv.aliases are not loaded (list-mode payload has no aliases)', () => {
    const osv = { ...baseOsv, aliases: undefined };
    const out = mapVulnerabilityScaEntityToListMetadata(
      osv,
      {
        packageName: 'lodash',
        ecosystem: 'npm',
        hasFix: false,
        fixedVersion: '',
      },
      'CVE-2024-9999',
    );
    expect(out.cve).toBe('CVE-2024-9999');
  });
});

describe('mapScaDetectionEntityToListInterface', () => {
  const makeDetection = () =>
    ({
      id: 'det-1',
      projectId: 'p-1',
      createdAt: new Date('2025-02-01T00:00:00Z'),
      updatedAt: new Date('2025-02-02T00:00:00Z'),
      currentState: 'to_verify',
      currentSeverity: 'critical',
      currentPriority: 'urgent',
      currentCVSS: 9.8,
      branch: 'main',
      scoringSource: 'static',
      scaDetectedPackage: {
        id: 'pkg-1',
        projectId: 'p-1',
        packageName: 'lodash',
        packageVersion: '4.17.20',
        fileName: 'package-lock.json',
        ecosystem: 'npm',
        isTransitive: false,
        isDev: false,
        path: ['package-lock.json'],
        importLocations: [],
        licenses: ['MIT'],
      },
      vulnerability: {
        id: 'GHSA-xxxx-yyyy',
        internalId: 'osv-1',
        summary: 'Prototype pollution',
        details: 'HUGE'.repeat(5000),
        schemaVersion: '1.0.0',
        modifiedAt: new Date('2025-01-01T00:00:00Z'),
        publishedAt: new Date('2024-12-01T00:00:00Z'),
        createdAt: new Date('2024-11-01T00:00:00Z'),
        updatedAt: new Date('2025-01-02T00:00:00Z'),
        databaseSpecific: { cwe_ids: ['CWE-1321'], severity: 'HIGH' },
        aliases: [{ id: 'a1', alias: 'CVE-2024-0001' }],
        severities: [{ id: 's1', type: 'CVSS_V3', score: '9.8' }],
        references: [
          { id: 'r1', type: 'ADVISORY', url: 'https://example.test' },
        ],
        affected: [],
      },
      historyItems: [],
      scaAutofixRecords: [],
    }) as any;

  it('uses the light metadata mapper so aliases/references/severities/details are empty', () => {
    const out = mapScaDetectionEntityToListInterface(makeDetection(), {
      hasFix: true,
      fixedVersion: '4.17.21',
    });
    expect(out.metadata?.aliases).toEqual([]);
    expect(out.metadata?.references).toEqual([]);
    expect(out.metadata?.severities).toEqual([]);
    expect(out.metadata?.details).toBe('');
  });

  it('threads the cveHint into list metadata.cve when aliases are not loaded', () => {
    const det = makeDetection();
    det.vulnerability.aliases = undefined; // list-mode: aliases join skipped
    const out = mapScaDetectionEntityToListInterface(
      det,
      { hasFix: false, fixedVersion: '' },
      undefined,
      'CVE-2024-7777',
    );
    expect(out.metadata?.cve).toBe('CVE-2024-7777');
  });

  it('still emits library / score / base identity used by the dashboard list table', () => {
    const out = mapScaDetectionEntityToListInterface(makeDetection(), {
      hasFix: true,
      fixedVersion: '4.17.21',
    });
    expect(out.library?.packageName).toBe('lodash');
    expect(out.library?.packageVersion).toBe('4.17.20');
    expect(out.cvssScore).toBeCloseTo(9.8, 1);
    expect(out.base?.id).toBe('det-1');
    expect(out.base?.currentSeverity).toBe('critical');
  });

  it('reflects hasFix in metadata.packages[0].fixAvailable', () => {
    const outFix = mapScaDetectionEntityToListInterface(makeDetection(), {
      hasFix: true,
      fixedVersion: '4.17.21',
    });
    expect(outFix.metadata?.packages?.[0]?.fixAvailable).toBe(true);
    expect(outFix.metadata?.packages?.[0]?.fixed).toBe('4.17.21');

    const outNoFix = mapScaDetectionEntityToListInterface(makeDetection(), {
      hasFix: false,
      fixedVersion: '',
    });
    expect(outNoFix.metadata?.packages?.[0]?.fixAvailable).toBe(false);
  });

  it('falls back to no packages when scaDetectedPackage is missing', () => {
    const det = makeDetection();
    det.scaDetectedPackage = undefined;
    const out = mapScaDetectionEntityToListInterface(det, {
      hasFix: false,
      fixedVersion: '',
    });
    expect(out.metadata?.packages).toEqual([]);
    expect(out.library).toBeUndefined();
  });
});
