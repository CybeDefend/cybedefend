import {
  validateDiffZipEntries,
  DiffArchiveCaps,
  DiffZipEntry,
} from './diff-archive.util';

const CAPS: DiffArchiveCaps = {
  maxFiles: 5,
  maxFileBytes: 1000,
  maxTotalBytes: 2000,
};

const e = (p: string, size = 1): DiffZipEntry => ({ path: p, size });

describe('validateDiffZipEntries', () => {
  it('keeps normal code/IaC files', () => {
    const out = validateDiffZipEntries(
      [e('src/app.py'), e('infra/main.tf')],
      CAPS,
    );
    expect(out).toEqual(['src/app.py', 'infra/main.tf']);
  });

  it('skips directory entries', () => {
    const out = validateDiffZipEntries([e('src/', 0), e('src/app.py')], CAPS);
    expect(out).toEqual(['src/app.py']);
  });

  it('rejects path traversal and absolute paths', () => {
    expect(() => validateDiffZipEntries([e('../etc/passwd')], CAPS)).toThrow();
    expect(() => validateDiffZipEntries([e('/etc/passwd')], CAPS)).toThrow();
    expect(() => validateDiffZipEntries([e('a/../../b')], CAPS)).toThrow();
  });

  it('rejects a forged .git tree from the agent', () => {
    expect(() => validateDiffZipEntries([e('.git/config')], CAPS)).toThrow();
  });

  it('throws when there are no entries', () => {
    expect(() => validateDiffZipEntries([], CAPS)).toThrow();
  });

  it('enforces the file-count cap', () => {
    const many = Array.from({ length: 6 }, (_, i) => e(`f${i}.py`));
    expect(() => validateDiffZipEntries(many, CAPS)).toThrow();
  });

  // Excluded files must not count toward the file-count cap — a small real diff
  // padded with node_modules/ must still be accepted.
  it('counts only kept files toward the file-count cap (ignores excluded)', () => {
    const many = [
      ...Array.from({ length: 200 }, (_, i) =>
        e(`node_modules/pkg${i}/index.js`),
      ),
      ...Array.from({ length: 5 }, (_, i) => e(`src/f${i}.py`)),
    ];
    const out = validateDiffZipEntries(many, CAPS);
    expect(out).toEqual([
      'src/f0.py',
      'src/f1.py',
      'src/f2.py',
      'src/f3.py',
      'src/f4.py',
    ]);
  });

  it('still rejects when the KEPT file count exceeds the cap', () => {
    const many = [
      ...Array.from({ length: 200 }, (_, i) =>
        e(`node_modules/pkg${i}/index.js`),
      ),
      ...Array.from({ length: 6 }, (_, i) => e(`src/f${i}.py`)),
    ];
    expect(() => validateDiffZipEntries(many, CAPS)).toThrow(
      /Too many changed files/,
    );
  });

  it('enforces the per-file and aggregate size caps', () => {
    expect(() => validateDiffZipEntries([e('big.py', 1001)], CAPS)).toThrow();
    expect(() =>
      validateDiffZipEntries([e('a.py', 900), e('b.py', 1200)], CAPS),
    ).toThrow();
  });

  it('skips excluded files but keeps the rest; throws if nothing is left', () => {
    const out = validateDiffZipEntries(
      [e('node_modules/lib/index.js'), e('src/app.py')],
      CAPS,
    );
    expect(out).toEqual(['src/app.py']);
    expect(() =>
      validateDiffZipEntries([e('node_modules/a.js')], CAPS),
    ).toThrow();
  });

  it('does not count excluded files toward the aggregate size cap', () => {
    // 1500B of excluded node_modules + 900B of source = 2400B > maxTotalBytes
    // (2000); only the 900B source must count, so this must NOT trip the cap.
    const out = validateDiffZipEntries(
      [e('node_modules/big/index.js', 1500), e('src/app.py', 900)],
      CAPS,
    );
    expect(out).toEqual(['src/app.py']);
  });

  it('does not apply the per-file size cap to excluded files', () => {
    // An excluded file above maxFileBytes (1000) must be dropped, not rejected.
    const out = validateDiffZipEntries(
      [e('node_modules/huge.js', 5000), e('src/app.py', 10)],
      CAPS,
    );
    expect(out).toEqual(['src/app.py']);
  });
});
