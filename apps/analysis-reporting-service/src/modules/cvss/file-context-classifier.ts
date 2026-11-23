// Code-based file path classifier .
// Derives a coarse "is this a genuine test file?" signal from the path so the
// static exploitability stays code-based. Only an unambiguous test-file suffix
// (.test/.spec/_test/_spec) on a SOURCE-CODE file demotes a finding.
//
// Directory-name heuristics (tests/, migrations/, examples/, docs/, vendor/,
// node_modules/, fixtures/…) were intentionally REMOVED: a folder name is not a
// reliable signal of non-production code — e.g. a `docs/search/` module is
// production runtime code, not documentation — and demoting on it hid real
// vulnerabilities (a critical SQL injection) behind a "not_exploitable" verdict.
// We now prefer surfacing over hiding: anything that is not an obvious test file
// stays production and keeps its real exploitability.

export type FileContext = 'test' | 'production';

// A test is, by definition, executable CODE. So we only demote a file whose
// name carries a `.test`/`.spec`/`_test`/`_spec` marker AND ends in a recognised
// SOURCE-CODE extension. This anchors two ways at once:
//   - on a dot/underscore separator before the marker, so a "test"/"spec"
//     substring inside an unrelated name (contest, latest, conftest, manifest)
//     never matches;
//   - on a code extension at the end of the path, so a "specification" or
//     "test-environment config" DATA file (openapi.spec.json, payments.spec.proto,
//     .env.test.local, credentials.test.json) is NOT mistaken for test code and
//     a real vuln/secret there is never hidden.
// The pattern is a flat sequence of character classes / literal alternations
// with a single end-anchor — linear-time, ReDoS-safe even on adversarial paths.
const CODE_EXT =
  'ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|kts|cs|php|rs|c|cc|cpp|cxx|h|hpp|hh|scala|swift|m|mm|dart|ex|exs|groovy';
const TEST_SUFFIX_RE = new RegExp(`[._](?:test|spec)\\.(?:${CODE_EXT})$`, 'i');

export function classifyFileContext(
  path: string | null | undefined,
): FileContext {
  if (!path) return 'production';
  return TEST_SUFFIX_RE.test(path) ? 'test' : 'production';
}
