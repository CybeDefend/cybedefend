/**
 * The ecosystem of a target file name and of a Grype package type.
 * Every match is on the lower-cased
 * base name of the target; a pattern with `*` matches the extension. One
 * exception: the installed Python distributions of an image (`*.dist-info/
 * METADATA`, `*.egg-info`), which only their folder names.
 */

const FILE_ECOSYSTEMS: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    'npm',
    [
      'package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'bun.lock',
      'package.json',
    ],
  ],
  [
    'PyPI',
    [
      'requirements*.txt',
      'pipfile.lock',
      'poetry.lock',
      'uv.lock',
      'pdm.lock',
      'pyproject.toml',
      'setup.py',
    ],
  ],
  ['Go', ['go.mod', 'go.sum']],
  ['crates.io', ['cargo.lock', 'cargo.toml']],
  [
    'Maven',
    ['pom.xml', 'gradle.lockfile', 'build.gradle', 'build.gradle.kts', '*.jar'],
  ],
  ['Packagist', ['composer.lock', 'composer.json']],
  ['RubyGems', ['gemfile.lock', 'gemfile', '*.gemspec']],
  [
    'NuGet',
    ['packages.lock.json', 'packages.config', '*.csproj', '*.deps.json'],
  ],
  ['Pub', ['pubspec.lock', 'pubspec.yaml']],
  ['Hex', ['mix.lock']],
];

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const starPattern = (pattern: string): RegExp =>
  // cybedefend-ignore[CD-SAST-0434]: the patterns are the constants of FILE_ECOSYSTEMS, escaped part by part, each with one `*`, so matching is linear in the file name
  new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);

interface FileMatcher {
  ecosystem: string;
  test: (baseName: string) => boolean;
}

const FILE_MATCHERS: FileMatcher[] = FILE_ECOSYSTEMS.flatMap(
  ([ecosystem, patterns]) =>
    patterns.map((raw) => {
      const pattern = raw.toLowerCase();
      if (pattern.includes('*')) {
        const regex = starPattern(pattern);
        return {
          ecosystem,
          test: (baseName: string): boolean => regex.test(baseName),
        };
      }
      return {
        ecosystem,
        test: (baseName: string): boolean => baseName === pattern,
      };
    }),
);

/**
 * An installed Python distribution, as Trivy reports it in image mode: the
 * `METADATA` of a `*.dist-info` folder, the `PKG-INFO` of a `*.egg-info`
 * folder, or a `*.egg-info` file. Its base name alone says nothing.
 */
function isPythonDistribution(segments: string[]): boolean {
  const baseName = segments[segments.length - 1];
  const parent = segments[segments.length - 2] ?? '';
  return (
    (baseName === 'metadata' && parent.endsWith('.dist-info')) ||
    (baseName === 'pkg-info' && parent.endsWith('.egg-info')) ||
    baseName.endsWith('.egg-info')
  );
}

/** The ecosystem of a target path, from its lower-cased base name; else 'unknown'. */
export function ecosystemOfTarget(target: string): string {
  const segments = target.toLowerCase().split('/');
  const baseName = segments[segments.length - 1] ?? '';
  if (baseName === '') return 'unknown';
  if (isPythonDistribution(segments)) return 'PyPI';
  for (const matcher of FILE_MATCHERS) {
    if (matcher.test(baseName)) return matcher.ecosystem;
  }
  return 'unknown';
}

const GRYPE_ECOSYSTEMS: Readonly<Record<string, string>> = {
  npm: 'npm',
  python: 'PyPI',
  'go-module': 'Go',
  'rust-crate': 'crates.io',
  'java-archive': 'Maven',
  'php-composer': 'Packagist',
  gem: 'RubyGems',
  dotnet: 'NuGet',
  'dart-pub': 'Pub',
  hex: 'Hex',
  apk: 'Alpine',
  deb: 'Debian',
  rpm: 'Red Hat',
};

/** The ecosystem of a Grype package type; null when the type has none. */
export function ecosystemOfGrypeType(type: string): string | null {
  return GRYPE_ECOSYSTEMS[type] ?? GRYPE_ECOSYSTEMS[type.toLowerCase()] ?? null;
}

/**
 * A package URL type's ecosystem, spelled as the two tables above spell it
 * (a CycloneDX SBOM names its packages by purl). Any other type is kept as
 * it is, lower-cased by the purl parser.
 */
const PURL_ECOSYSTEMS: Readonly<Record<string, string>> = {
  npm: 'npm',
  pypi: 'PyPI',
  golang: 'Go',
  cargo: 'crates.io',
  maven: 'Maven',
  composer: 'Packagist',
  gem: 'RubyGems',
  nuget: 'NuGet',
  pub: 'Pub',
  hex: 'Hex',
  apk: 'Alpine',
  deb: 'Debian',
  rpm: 'Red Hat',
};

export function ecosystemOfPurlType(type: string): string {
  return PURL_ECOSYSTEMS[type] ?? type;
}

/** The ten language ecosystems of the file-name table. */
const LANGUAGE_ECOSYSTEMS: ReadonlySet<string> = new Set(
  FILE_ECOSYSTEMS.map(([ecosystem]) => ecosystem),
);

export function isLanguageEcosystem(ecosystem: string): boolean {
  return LANGUAGE_ECOSYSTEMS.has(ecosystem);
}
