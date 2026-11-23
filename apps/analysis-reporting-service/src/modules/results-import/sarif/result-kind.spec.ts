import {
  ImportType,
  ResultKind,
  resultKindOf,
  typeTakesKind,
} from './result-kind';
import { SarifRule } from './sarif.types';

const ruleWithTags = (tags: unknown): SarifRule => ({
  id: 'r',
  properties: { tags },
});

describe('result-kind', () => {
  it('reads the Trivy kind from the first tag of the rule', () => {
    expect(
      resultKindOf('trivy', ruleWithTags(['vulnerability', 'security'])),
    ).toBe('vulnerability');
    expect(resultKindOf('trivy', ruleWithTags(['Misconfiguration']))).toBe(
      'misconfiguration',
    );
    expect(resultKindOf('trivy', ruleWithTags(['secret']))).toBe('secret');
    expect(resultKindOf('trivy', ruleWithTags(['LICENSE']))).toBe('license');
    expect(resultKindOf('trivy', ruleWithTags(['security']))).toBeNull();
    expect(resultKindOf('trivy', ruleWithTags(['vulnerabilities']))).toBeNull();
    expect(resultKindOf('trivy', ruleWithTags([]))).toBeNull();
    expect(resultKindOf('trivy', ruleWithTags(undefined))).toBeNull();
    expect(resultKindOf('trivy', ruleWithTags('vulnerability'))).toBeNull();
    expect(resultKindOf('trivy', ruleWithTags([42]))).toBeNull();
    expect(resultKindOf('trivy', { id: 'r' })).toBeNull();
    expect(resultKindOf('trivy', undefined)).toBeNull();
  });

  it('treats every Grype and osv-scanner result as a vulnerability', () => {
    expect(resultKindOf('grype', undefined)).toBe('vulnerability');
    expect(resultKindOf('grype', ruleWithTags(['secret']))).toBe(
      'vulnerability',
    );
    expect(resultKindOf('osv-scanner', undefined)).toBe('vulnerability');
    expect(resultKindOf('osv-scanner', ruleWithTags(['license']))).toBe(
      'vulnerability',
    );
  });

  it('lets the import type take a result of an unknown tool or of a Trivy rule without a known first tag', () => {
    expect(resultKindOf('semgrep', ruleWithTags(['vulnerability']))).toBeNull();
    expect(resultKindOf('trivy', ruleWithTags(['other']))).toBeNull();
    const types: ImportType[] = [
      'sast',
      'iac',
      'secret',
      'cicd',
      'sca',
      'container',
    ];
    for (const type of types) {
      expect(typeTakesKind(type, resultKindOf('semgrep', undefined))).toBe(
        true,
      );
      expect(typeTakesKind(type, null)).toBe(true);
    }
  });

  it('takes each kind by its type only, and a licence by none', () => {
    const types: ImportType[] = [
      'sast',
      'iac',
      'secret',
      'cicd',
      'sca',
      'container',
    ];
    const takes: Record<ResultKind, ImportType[]> = {
      vulnerability: ['sca', 'container'],
      misconfiguration: ['iac'],
      secret: ['secret'],
      license: [],
    };
    for (const kind of Object.keys(takes) as ResultKind[]) {
      for (const type of types) {
        expect(typeTakesKind(type, kind)).toBe(takes[kind].includes(type));
      }
    }
    for (const type of types) {
      expect(typeTakesKind(type, null)).toBe(true);
    }
  });
});
