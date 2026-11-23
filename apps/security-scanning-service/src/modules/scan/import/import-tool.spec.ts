import { normaliseToolList } from './import-tool';

/**
 * `scan.importTool` holds the comma-separated tool list
 * `CompleteImportScan.tool_name` reports, as a varchar(255). One tool name is `[a-z0-9._-]{1,64}`.
 */
describe('normaliseToolList', () => {
  it('lower-cases each element, strips characters outside [a-z0-9._-] and keeps the commas', () => {
    expect(normaliseToolList('Semgrep OSS,CodeQL')).toBe('semgreposs,codeql');
  });

  it('drops elements that end up empty', () => {
    expect(normaliseToolList('semgrep,,***')).toBe('semgrep');
  });

  it('returns null when nothing survives', () => {
    expect(normaliseToolList('')).toBeNull();
    expect(normaliseToolList('***')).toBeNull();
    expect(normaliseToolList(null)).toBeNull();
    expect(normaliseToolList(undefined)).toBeNull();
  });

  it('cuts each element to 64 characters', () => {
    expect(normaliseToolList(`a${'b'.repeat(99)}`)).toBe(`a${'b'.repeat(63)}`);
  });

  it('cuts the joined list to 255 characters at an element boundary', () => {
    const elements = Array.from({ length: 10 }, (_, i) =>
      `tool${i}`.padEnd(40, 'x'),
    );
    const out = normaliseToolList(elements.join(','));

    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(255);
    // No element is cut in two: every part of the result is one whole input element.
    for (const part of out!.split(',')) {
      expect(elements).toContain(part);
    }
  });
});
