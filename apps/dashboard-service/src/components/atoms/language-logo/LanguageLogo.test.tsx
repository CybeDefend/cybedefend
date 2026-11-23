import { describe, it, expect } from 'vitest';
import { normalizeLanguageKey } from './LanguageLogo';

describe('normalizeLanguageKey', () => {
  it('maps canonical language names', () => {
    expect(normalizeLanguageKey('JavaScript')).toBe('javascript');
    expect(normalizeLanguageKey('TypeScript')).toBe('typescript');
    expect(normalizeLanguageKey('Python')).toBe('python');
    expect(normalizeLanguageKey('Java')).toBe('java');
  });

  it('resolves common aliases', () => {
    expect(normalizeLanguageKey('js')).toBe('javascript');
    expect(normalizeLanguageKey('ts')).toBe('typescript');
    expect(normalizeLanguageKey('golang')).toBe('go');
    expect(normalizeLanguageKey('C++')).toBe('cpp');
    expect(normalizeLanguageKey('c#')).toBe('csharp');
    expect(normalizeLanguageKey('Dockerfile')).toBe('docker');
    expect(normalizeLanguageKey('HCL')).toBe('terraform');
    expect(normalizeLanguageKey('shell')).toBe('bash');
  });

  it('strips a parenthetical qualifier (e.g. "JavaScript (React)")', () => {
    expect(normalizeLanguageKey('JavaScript (React)')).toBe('javascript');
  });

  it('returns null for unknown / other / empty so the caller shows a fallback', () => {
    expect(normalizeLanguageKey('other')).toBeNull();
    expect(normalizeLanguageKey('Other')).toBeNull();
    expect(normalizeLanguageKey('')).toBeNull();
    expect(normalizeLanguageKey(undefined)).toBeNull();
    expect(normalizeLanguageKey('cobol')).toBeNull();
  });
});
