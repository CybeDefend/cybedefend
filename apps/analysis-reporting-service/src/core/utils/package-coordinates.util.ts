/**
 * Package names and versions read from a customer's repository.
 *
 * The SCA scanner takes them from the customer's manifests and lockfiles, so
 * they are whatever the customer wrote. The autofix writes them into files that
 * a package manager evaluates: the closed autofix library's sandbox manifests (a Gemfile is Ruby,
 * a build.gradle is Groovy, a .csproj is MSBuild, a pyproject.toml and a go.mod
 * are read by Poetry and Go), passes them as command-line arguments, and writes
 * them into the customer's manifest. A quote, a newline, a space, a leading
 * dash or a URL in one of them is code, an option or a download for that
 * package manager.
 *
 * Only the characters that registries use are accepted: letters, digits and
 * `@ . _ - / :` in a name (npm scopes, Maven `group:artifact`, Go module
 * paths), letters, digits and `. _ - +` in a version. A value that starts with
 * anything but a letter, a digit or `@`, or that holds `..`, `//` or `:/`,
 * is refused too: those are paths, URLs or options, never a package.
 */

const PACKAGE_NAME = /^(?=.*[A-Za-z0-9])[A-Za-z0-9@][A-Za-z0-9@._\-/:]{0,255}$/;
const PACKAGE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._\-+]{0,63}$/;

function hasPathOrUrlShape(value: string): boolean {
  return value.includes('..') || value.includes('//') || value.includes(':/');
}

export function isSafePackageName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    PACKAGE_NAME.test(name) &&
    !hasPathOrUrlShape(name)
  );
}

export function isSafePackageVersion(version: unknown): version is string {
  return (
    typeof version === 'string' &&
    PACKAGE_VERSION.test(version) &&
    !version.includes('..')
  );
}

/**
 * An entry of a dependency path: `name@version`, or a bare `name`. The
 * version follows the last `@`, so a scoped npm name keeps its leading one.
 */
export function isSafeDependencyPathEntry(entry: unknown): entry is string {
  if (typeof entry !== 'string') {
    return false;
  }
  const at = entry.lastIndexOf('@');
  if (at <= 0) {
    return isSafePackageName(entry);
  }
  return (
    isSafePackageName(entry.slice(0, at)) &&
    isSafePackageVersion(entry.slice(at + 1))
  );
}
