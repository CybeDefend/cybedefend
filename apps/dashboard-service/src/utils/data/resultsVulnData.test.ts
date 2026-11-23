import { describe, it, expect } from 'vitest';
import * as vulnData from './resultsVulnData';
import {
  pickCvssForTable,
  exploitabilityDefaultValues,
  exploitabilityOptions,
  statusDefaultValues,
} from './resultsVulnData';

describe('exploitability filter default', () => {
  it('defaults to every verdict, including not_exploitable (audit-aid field, shown in full by default)', () => {
    // Exploitability is an audit-assistance field, not a triage filter like
    // status — the default selection must show every verdict so nothing is
    // silently hidden from the auditor.
    expect(exploitabilityDefaultValues).toContain('not_exploitable');
    expect(exploitabilityDefaultValues).toEqual(
      exploitabilityOptions.map((o) => o.value),
    );
  });

  it('no longer exposes a triage subset default that hides not_exploitable', () => {
    // Regression guard: the legacy `exploitabilityTriageValues` constant
    // excluded not_exploitable and was used as the initial page selection.
    // It must stay removed so the default never drops a verdict again.
    expect(
      (vulnData as Record<string, unknown>).exploitabilityTriageValues,
    ).toBeUndefined();
  });
});

describe('status filter default', () => {
  it('defaults to the 2 active states and never the excluded ones (resolved/not_exploitable/proposed_not_exploitable/ignored)', () => {
    // The status filter is a triage filter: the default list view must show
    // only active vulnerabilities and stay in sync with the backend
    // ACTIVE_VULN_STATES, otherwise frontend totals diverge from the overview
    // counters. `proposed_not_exploitable` was retired from the status
    // dimension (migration 1803 remapped it to to_verify), so the active set is
    // now just to_verify + confirmed.
    expect(statusDefaultValues).toEqual(['to_verify', 'confirmed']);
    for (const excluded of [
      'resolved',
      'not_exploitable',
      'proposed_not_exploitable',
      'ignored',
    ]) {
      expect(statusDefaultValues).not.toContain(excluded);
    }
  });
});

describe('pickCvssForTable', () => {
  it('returns v4 environmental when both v4 scores present', () => {
    expect(
      pickCvssForTable({
        cvss4EnvironmentalScore: 9.1,
        cvss4BaseScore: 8.7,
      }),
    ).toEqual({ score: 9.1, version: 'v4' });
  });

  it('returns v4 base when only base is set', () => {
    expect(
      pickCvssForTable({
        cvss4BaseScore: 8.7,
      }),
    ).toEqual({ score: 8.7, version: 'v4' });
  });

  it('falls back to legacyScore (SCA cvssScore) when no v4', () => {
    expect(
      pickCvssForTable({
        legacyScore: 7.5,
      }),
    ).toEqual({ score: 7.5, version: 'v3' });
  });

  it('falls back to cvss3BaseScore parsed from string when no v4 nor legacyScore', () => {
    // Old SAST/IAC scans only carry vulnerability.cvss3.baseScore (string).
    // The list view and Scoring tab must render this rather than "—" / "N/A".
    expect(
      pickCvssForTable({
        cvss3BaseScore: '7.8',
      }),
    ).toEqual({ score: 7.8, version: 'v3' });
  });

  it('accepts cvss3BaseScore as number', () => {
    expect(
      pickCvssForTable({
        cvss3BaseScore: 6.4,
      }),
    ).toEqual({ score: 6.4, version: 'v3' });
  });

  it('prefers cvss4 over cvss3BaseScore when both are present', () => {
    expect(
      pickCvssForTable({
        cvss4BaseScore: 9.0,
        cvss3BaseScore: '7.8',
      }),
    ).toEqual({ score: 9.0, version: 'v4' });
  });

  it('returns null score with v3 label when nothing is set', () => {
    expect(pickCvssForTable({})).toEqual({ score: null, version: 'v3' });
  });

  it('honors legacyLabel for SCA-only legacy chip', () => {
    expect(
      pickCvssForTable({
        legacyScore: 7.0,
        legacyLabel: 'legacy',
      }),
    ).toEqual({ score: 7.0, version: 'legacy' });
  });

  it('treats non-numeric cvss3BaseScore strings as missing', () => {
    expect(
      pickCvssForTable({
        cvss3BaseScore: 'N/A',
      }),
    ).toEqual({ score: null, version: 'v3' });
  });

  it('treats zero cvss3BaseScore as missing (legacy "0.0" sentinel)', () => {
    // Some old SAST/IAC vulns store "0.0" as the literal string when no CVSS
    // was assigned. We must not render 0.0 in the badge.
    expect(
      pickCvssForTable({
        cvss3BaseScore: '0.0',
      }),
    ).toEqual({ score: null, version: 'v3' });
  });
});
