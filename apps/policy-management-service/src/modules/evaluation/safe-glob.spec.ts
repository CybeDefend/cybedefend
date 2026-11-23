import { globMatch, hasRiskyRepeatedExtglob } from './safe-glob';

/**
 * Policy authors write the globs (exclusion patterns, branch rules) and the
 * scanned repository supplies the subject (file paths, branch names). A
 * repeated extglob whose body holds an unbounded `*` compiles to a nested
 * quantifier (`(?:[^/]*?a)+`) that backtracks exponentially in the picomatch
 * releases available today, which would block the evaluation worker.
 */
describe('globMatch', () => {
  const elapsed = (fn: () => void): number => {
    const start = Date.now();
    fn();
    return Date.now() - start;
  };

  describe('keeps the glob semantics policies rely on', () => {
    it.each([
      ['src/app/main.ts', 'src/**'],
      ['src/app/main.test.ts', '**/*.test.ts'],
      ['tests/unit/a.spec.js', 'tests/**'],
      ['main', 'main'],
      ['release/1.2', 'release/*'],
      ['feature/login', 'feature/**'],
      ['develop', '@(main|develop)'],
      ['a/b.ts', '**/*.@(ts|js)'],
      ['hotfix-1', 'hotfix-?'],
      ['foo', '!(bar)'],
      ['abcabc', '+(abc)'],
      ['foobar', '*(foo|bar)'],
      ['.github/workflows/ci.yml', '.github/**'],
    ])('%s matches %s', (subject, pattern) => {
      expect(globMatch(subject, pattern)).toBe(true);
    });

    it.each([
      ['src/app/main.ts', 'tests/**'],
      ['feature/login', 'feature/*/x'],
      ['staging', '@(main|develop)'],
      ['bar', '!(bar)'],
      ['hotfix-12', 'hotfix-?'],
    ])('%s does not match %s', (subject, pattern) => {
      expect(globMatch(subject, pattern)).toBe(false);
    });
  });

  describe('flags every repeated extglob but plain prefix-free alternatives', () => {
    it.each([
      '+(*)',
      '+(*a)',
      '*(*a)',
      '+(a|*b)',
      '+(@(*a))',
      '+(**)',
      'src/+(*.ts)',
      '{x,+(*a)}',
      '+(?*a)',
      '+(?)',
      '*([a]|?(a))',
      '+(a|aa)',
      '+(ab|a)',
      '+(a|)',
      '+(a|a)',
      '*({a,b})',
      '@(+(a|aa))',
    ])('%s is risky', (pattern) => {
      expect(hasRiskyRepeatedExtglob(pattern)).toBe(true);
    });

    it.each([
      'src/**',
      '**/*.test.ts',
      '@(*a)',
      '?(*a)',
      '!(*a)',
      '+(abc)',
      '*(foo|bar)',
      '+(ab|ba)',
      '\\+(*a)',
      '[+(]*a',
      'a+(b)*',
    ])('%s is not risky', (pattern) => {
      expect(hasRiskyRepeatedExtglob(pattern)).toBe(false);
    });
  });

  describe('never backtracks catastrophically', () => {
    const subjects = [
      'a'.repeat(40) + '!',
      '.'.repeat(40) + '!',
      'a/'.repeat(20) + '!',
    ];

    it.each([
      '+(*a)',
      '*(*a)',
      '+(*.)',
      '+(a|*a)',
      '+(@(*a))',
      'x/+(*a)/y',
      '*([a]|?(a))',
      '+(a|aa)',
    ])('evaluates %s quickly', (pattern) => {
      for (const subject of subjects) {
        expect(elapsed(() => globMatch(subject, pattern))).toBeLessThan(200);
      }
    });

    it('drops the extglob syntax of a risky pattern and keeps its wildcards', () => {
      expect(globMatch('+(*a)', '+(*a)')).toBe(true);
      expect(globMatch('aaa', '+(*a)')).toBe(false);
    });

    it('survives random repeated extglobs, the shape that backtracks', () => {
      const pieces = [
        'a',
        'b',
        '.',
        '*',
        '?',
        '**',
        '|',
        '!(a)',
        '@(a|b)',
        '?(a)',
        '[a]',
        '/',
      ];
      const wrappers: Array<[string, string]> = [
        ['', ''],
        ['x/', ''],
        ['@(', ')'],
        ['!(', ')'],
      ];
      // 32-bit LCG: Math.imul keeps every bit, a plain product past 2^53 does not.
      let seed = 42;
      const next = (n: number): number => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return (seed >>> 8) % n;
      };
      let risky = 0;
      for (let i = 0; i < 400; i++) {
        let body = '';
        for (let j = 0, n = 1 + next(4); j < n; j++)
          body += pieces[next(pieces.length)];
        const [open, close] = wrappers[next(wrappers.length)];
        const pattern = `${open}${next(2) === 0 ? '+' : '*'}(${body})${close}`;
        if (hasRiskyRepeatedExtglob(pattern)) risky++;
        for (const subject of subjects) {
          const ms = elapsed(() => globMatch(subject, pattern));
          if (ms >= 200)
            throw new Error(`${pattern} took ${ms} ms on ${subject}`);
        }
      }
      // The generator must actually reach the dangerous shape.
      expect(risky).toBeGreaterThan(50);
    });
  });
});
