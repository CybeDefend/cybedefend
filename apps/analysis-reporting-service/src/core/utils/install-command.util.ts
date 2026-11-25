/**
 * The install command shown with a fix, which a member of the organization
 * copies and runs in his own shell.
 *
 * The package name and the version come from the scanned repository (its
 * manifests and lock files) and from the registry, so whoever commits to that
 * repository chooses them. A value is placed in the command only when it is a
 * name or a version of its ecosystem, checked against that ecosystem's naming
 * rules (stricter where they allow more). When one is not, there is no command
 * at all: a value is never cleaned up and inserted.
 *
 * Every pattern keeps to ASCII letters, digits and `. _ - / @ : +`, which no
 * common shell (POSIX shells, zsh, PowerShell, cmd) gives a meaning to inside
 * a word, so the command reads the same wherever it is pasted. Each value must
 * also start with a letter, a digit or `@`, so it is never read as an option.
 */

const NAME_MAX = 214;
const VERSION_MAX = 64;

/** `1.2.3`, `1.2.3-rc.1`, `1.2.3+build.5` (Semantic Versioning 2.0). */
const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** npm: an optional `@scope/` then the name (legacy names keep upper case). */
const NPM_NAME =
  /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** PyPI: PEP 508 names. */
const PYPI_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * PyPI: PEP 440 public versions, without the epoch (`1!2.0`): `!` is history
 * expansion in an interactive bash or zsh.
 */
const PYPI_VERSION =
  /^\d+(?:\.\d+)*(?:[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview)[-_.]?\d*)?(?:-\d+|[-_.]?(?:post|rev|r)[-_.]?\d*)?(?:[-_.]?dev[-_.]?\d*)?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$/i;

/** Maven: `groupId:artifactId`, or the artifact alone. */
const MAVEN_NAME =
  /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*:)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const MAVEN_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Go: a module path whose first element is a domain name, then elements of
 * letters, digits, `_` and `-` joined by single dots (no `.` or `..` element).
 */
const GO_MODULE =
  /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/;

/** NuGet: package ids, and versions of two to four numbers plus labels. */
const NUGET_NAME = /^[A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*$/;
const NUGET_VERSION =
  /^\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Composer: `vendor/package`, and one exact version. Composer compares names
 * without regard to case, so either case is accepted and kept as written.
 */
const PACKAGIST_NAME =
  /^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]|-{1,2})?[a-z0-9]+)*$/i;
const PACKAGIST_VERSION =
  /^v?\d+(?:\.\d+){0,3}(?:-?(?:stable|beta|b|RC|rc|alpha|a|patch|pl|p)(?:[.-]?\d+)*)?$/;

/** RubyGems: gem names, and versions of dot-separated segments. */
const GEM_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GEM_VERSION = /^\d+(?:\.[0-9A-Za-z]+)*$/;

/** Cargo: crate names. */
const CRATE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * Swift packages: named by their GitHub repository, `github.com/owner/repo`
 * with an optional `https://`, as the versions are looked up there. No `..`.
 */
const SWIFT_NAME =
  /^(?!.*\.\.)(?:https:\/\/)?github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** The characters a word may hold: none of them needs quoting in any shell. */
const BARE_WORD = /^[A-Za-z0-9._/@:=+-]+$/;

/**
 * `value` as one shell word, or null. A value holding any other character is
 * refused rather than quoted, because quoting differs between POSIX shells,
 * PowerShell and cmd. An empty value, or one that starts with `-` (read as an
 * option), is refused too.
 */
export function shellWord(value: string): string | null {
  if (typeof value !== 'string' || value.startsWith('-')) {
    return null;
  }
  return BARE_WORD.test(value) ? value : null;
}

function matches(value: unknown, pattern: RegExp, max: number): boolean {
  return (
    typeof value === 'string' && value.length <= max && pattern.test(value)
  );
}

const NAME_PATTERNS: Record<string, RegExp> = {
  npm: NPM_NAME,
  pypi: PYPI_NAME,
  pip: PYPI_NAME,
  maven: MAVEN_NAME,
  go: GO_MODULE,
  nuget: NUGET_NAME,
  packagist: PACKAGIST_NAME,
  rubygems: GEM_NAME,
  crates: CRATE_NAME,
  swiftpm: SWIFT_NAME,
};

/**
 * Whether `name` is a package name of `ecosystem` (the same rules as the
 * install command). False for an ecosystem these rules do not cover.
 */
export function isEcosystemPackageName(
  ecosystem: string,
  name: unknown,
): name is string {
  const pattern = NAME_PATTERNS[ecosystem];
  return pattern !== undefined && matches(name, pattern, NAME_MAX);
}

/**
 * A command whose fixed text is the template and whose inserted values each
 * become one shell word; null when one of them cannot.
 */
function command(
  fixed: TemplateStringsArray,
  ...values: string[]
): string | null {
  const quoted = values.map(shellWord);
  if (quoted.some((word) => word === null)) {
    return null;
  }
  return fixed.reduce((out, text, i) => out + quoted[i - 1] + text);
}

/**
 * The command that installs `version` of `packageName` in `ecosystem`, or null
 * when the ecosystem is unknown or a value is not one of its names or versions.
 */
export function buildInstallCommand(
  ecosystem: string,
  packageName: string,
  version: string,
): string | null {
  const name = (pattern: RegExp) => matches(packageName, pattern, NAME_MAX);
  const ver = (pattern: RegExp) => matches(version, pattern, VERSION_MAX);

  switch (ecosystem) {
    case 'npm':
      return name(NPM_NAME) && ver(SEMVER)
        ? command`npm install ${`${packageName}@${version}`}`
        : null;
    case 'pypi':
    case 'pip':
      return name(PYPI_NAME) && ver(PYPI_VERSION)
        ? command`pip install ${`${packageName}==${version}`}`
        : null;
    case 'maven':
      return name(MAVEN_NAME) && ver(MAVEN_VERSION)
        ? command`# Update ${packageName} to version ${version} in pom.xml`
        : null;
    case 'go': {
      const bare = typeof version === 'string' ? version.replace(/^v/, '') : '';
      return name(GO_MODULE) && matches(bare, SEMVER, VERSION_MAX)
        ? command`go get ${`${packageName}@v${bare}`}`
        : null;
    }
    case 'nuget':
      return name(NUGET_NAME) && ver(NUGET_VERSION)
        ? command`dotnet add package ${packageName} --version ${version}`
        : null;
    case 'packagist':
      return name(PACKAGIST_NAME) && ver(PACKAGIST_VERSION)
        ? command`composer require ${`${packageName}:${version}`}`
        : null;
    case 'rubygems':
      return name(GEM_NAME) && ver(GEM_VERSION)
        ? command`gem install ${packageName} -v ${version}`
        : null;
    case 'crates':
      return name(CRATE_NAME) && ver(SEMVER)
        ? command`cargo add ${`${packageName}@${version}`}`
        : null;
    case 'swiftpm':
      return name(SWIFT_NAME) && ver(SEMVER)
        ? command`# Update ${packageName} to version ${version}`
        : null;
    default:
      return null;
  }
}
