import {
  MAX_GLOB_PATTERN_LENGTH,
  MAX_GLOB_SUBJECT_LENGTH,
  MAX_GLOB_WILDCARDS,
  compileGlob,
  globMatch,
  globPatternError,
  matchGlob,
  type GlobMeter,
} from './safe-glob';

// The glob library the evaluation used before: the reference for the meaning
// of every pattern.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const picomatch = require('picomatch') as {
  isMatch: (subject: string, pattern: string) => boolean;
};

/** 32-bit LCG: Math.imul keeps every bit, a plain product past 2^53 does not. */
const generator = (start: number) => {
  let seed = start;
  return (n: number): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % n;
  };
};

/**
 * Policy authors write the globs (exclusion patterns, branch rules) and the
 * scanned repository supplies the subject (file paths, branch names). The
 * matcher keeps the meaning patterns had with the previous library, and its
 * work stays bounded by the size of the compiled pattern times the path
 * length, whatever either holds.
 */
describe('globMatch', () => {
  const paths = [
    'src/app/main.ts',
    'src/app/main.test.ts',
    'src/main.ts',
    'src/.env',
    'src/a/.hidden/x.ts',
    'tests/unit/a.spec.js',
    'tests',
    'test/a.ts',
    'src/test/a.ts',
    'node_modules/lodash/index.js',
    '.github/workflows/ci.yml',
    '.env',
    'README.md',
    'lib/x.min.js',
    'vendor/x.min.js',
    'lib/x.js',
    'a/b/c.js',
    'a/b/c/d.py',
    'a.ts',
    'a.b',
    'ab',
    'abcabc',
    'foobar',
    '/abs/path/file.ts',
    'app@1.2.0→lodash@4.17.20',
    'main',
    '{main}',
    'develop',
    'release/1.2',
    'feature/login',
    'feat/(a)',
    'feat/a',
    '[x',
    'v2',
    'v4',
    'hotfix-1',
    'src/x/',
    '/x.js',
  ];

  describe('keeps the meaning patterns had', () => {
    const patterns = [
      'src/**',
      'src/*',
      '**/*.ts',
      '**/*.test.ts',
      '*',
      '**',
      '.github/**',
      '**/*.{ts,js}',
      '{src,lib}/**',
      '@(main|develop)',
      '+(abc)',
      '*(foo|bar)',
      '!src/**',
      './src/**',
      // A leading ** joined to a suffix crosses folders.
      '**.js',
      '**.min.js',
      '**.test.ts',
      './**.js',
      // Negated classes and groups.
      '[!x]b',
      '[!.]*',
      '!(*.js)',
      '**/!(*.spec).ts',
      'src/!(app)/**',
      // A single alternative and numeric ranges.
      '{main}',
      'v{1..3}',
      'hotfix-{0..9}',
      // Parentheses outside a group, an unclosed class.
      'feat/(a)',
      '[x',
      'a|b',
      // Edges of the previous library: a trailing slash, an empty first
      // segment.
      'src/*/',
      '*/*.js',
      '***',
    ];

    it.each(patterns)('%s matches as before', (pattern) => {
      expect(matchGlob('src/main.ts', pattern)).not.toHaveProperty('skipped');
      for (const subject of paths) {
        expect([subject, globMatch(subject, pattern)]).toEqual([
          subject,
          picomatch.isMatch(subject, pattern),
        ]);
      }
    });

    it('agrees with the previous library on 4,000 generated patterns and 300 paths', () => {
      const next = generator(2026);
      const names = [
        'src',
        'lib',
        'test',
        'a',
        'b',
        'x.js',
        'x.min.js',
        'a.ts',
        'b.test.ts',
        'main',
        'v2',
        '.env',
        '.github',
        'node_modules',
        'Foo.TS',
        'é.ts',
        '(a)',
        '{main}',
        'a b',
        'x\\y',
      ];
      const pathSet = new Set<string>();
      while (pathSet.size < 300) {
        const parts: string[] = [];
        for (let j = 0, n = 1 + next(4); j < n; j++) {
          parts.push(names[next(names.length)]);
        }
        let path = parts.join('/');
        const shape = next(12);
        if (shape === 0) path = `/${path}`;
        if (shape === 1) path = `${path}/`;
        if (shape === 2) path = `./${path}`;
        if (shape === 3) path = path.replace('/', '//');
        pathSet.add(path);
      }
      const generatedPaths = [...pathSet];

      const pieces = [
        'src',
        'lib',
        'a',
        'main',
        '.github',
        '*',
        '**',
        '?',
        '*.js',
        '*.ts',
        '**.js',
        '**.test.ts',
        '*.{ts,js}',
        '{src,lib}',
        '{main}',
        'v{1..3}',
        '[a-c]*',
        '[!a]*',
        '[^.]*',
        '[x',
        '!(*.js)',
        '!(a)',
        '@(a|b)',
        '?(a)',
        '+(a)',
        '*(a|b)',
        '(a)',
        'a|b',
        '\\*',
        'x*y',
        '.env',
      ];
      let compared = 0;
      let positives = 0;
      const differences: string[] = [];
      for (let i = 0; i < 4000; i++) {
        const segments: string[] = [];
        for (let j = 0, n = 1 + next(3); j < n; j++) {
          segments.push(pieces[next(pieces.length)]);
        }
        const prefix = ['', '', '', '', '!', './'][next(6)];
        const pattern = prefix + segments.join('/');
        for (const subject of generatedPaths) {
          const result = matchGlob(subject, pattern);
          const expected = picomatch.isMatch(subject, pattern);
          if (expected) positives++;
          if (!('matched' in result) || result.matched !== expected) {
            if (differences.length < 20) {
              differences.push(`${pattern} on ${subject}`);
            }
          }
          compared++;
        }
      }
      expect(differences).toEqual([]);
      expect(compared).toBe(4000 * 300);
      // Both answers occur often: the comparison is not one-sided.
      expect(positives).toBeGreaterThan(compared / 100);
      expect(positives).toBeLessThan(compared - compared / 100);
    }, 300_000);
  });

  describe('works in bounded time', () => {
    const path4k = 'a'.repeat(4000);
    const nestedPath = ('a/'.repeat(1999) + 'a').slice(0, 4000);

    it.each([
      ['*a*a*a*a*b', path4k],
      ['*a*a*a*a*a*a*a*a*b', path4k],
      ['**/*a*a*a*a*b', nestedPath],
      ['**/**/**/**/**/x', nestedPath],
      ['*a*a*a*a*b/**', nestedPath],
      ['+(ab|a)b', path4k],
      ['*(a|aa)b', path4k],
      ['!(*a*a*a*b)/x', path4k],
      ['{*a*a,*b*b,*c*c,*d*d}{*a,*b,*c,*d}{a,b,c,d}{1,2}*c', path4k],
    ])('%s on a 4,000-character path', (pattern, subject) => {
      const built = compileGlob(pattern);
      if (!('glob' in built)) throw new Error(built.error);
      const meter: GlobMeter = { steps: 0 };
      expect(globMatch(subject, pattern, meter)).toBe(false);
      // Deterministic: every state of the compiled automata, brace
      // alternatives and groups included, is visited a bounded number of
      // times per character.
      expect(meter.steps).toBeLessThanOrEqual(
        3 * built.glob.size * (subject.length + 1),
      );
    });

    it('still matches a long path the pattern describes', () => {
      expect(globMatch(path4k + 'b', '*a*a*a*a*b')).toBe(true);
      expect(globMatch(nestedPath + '/x.ts', '**/*.ts')).toBe(true);
    });

    it('skips a path past the length cap, and says why', () => {
      const long = `src/${'a'.repeat(MAX_GLOB_SUBJECT_LENGTH)}.ts`;
      expect(matchGlob(long, 'src/**')).toEqual({
        skipped: expect.stringContaining(
          `longer than ${MAX_GLOB_SUBJECT_LENGTH} characters`,
        ),
      });
      expect(globMatch(long, 'src/**')).toBe(false);
      const atCap = `src/${'a'.repeat(MAX_GLOB_SUBJECT_LENGTH - 7)}.ts`;
      expect(atCap.length).toBe(MAX_GLOB_SUBJECT_LENGTH);
      expect(globMatch(atCap, 'src/**')).toBe(true);
    });
  });

  describe('checks a pattern before it is stored', () => {
    it.each([
      '**.js',
      '[!x]b',
      '!(*.js)',
      '{main}',
      'v{1..3}',
      'feat/(a)',
      'src/**',
    ])('accepts %s', (pattern) => {
      expect(globPatternError(pattern)).toBeNull();
    });

    it('refuses a pattern past the length cap', () => {
      const pattern = 'a'.repeat(MAX_GLOB_PATTERN_LENGTH + 1);
      expect(globPatternError(pattern)).toContain('longer than');
      expect(globPatternError('a'.repeat(MAX_GLOB_PATTERN_LENGTH))).toBeNull();
    });

    it('refuses a pattern past the wildcard cap', () => {
      const within = Array(MAX_GLOB_WILDCARDS).fill('*').join('a');
      expect(globPatternError(within)).toBeNull();
      expect(globPatternError(`${within}a*`)).toContain('wildcards');
    });

    it('refuses an empty pattern', () => {
      expect(globPatternError('')).toContain('empty');
    });

    it('still evaluates a stored pattern past the caps, in bounded time', () => {
      const pattern = Array(MAX_GLOB_WILDCARDS + 2)
        .fill('*')
        .join('a');
      expect(matchGlob('aaaaaaaaaaaaaaaaaaaaaaaaa', pattern)).toEqual({
        matched: true,
      });
    });
  });
});
