/**
 * Languages for which the Code Graph (ingestion knowledge graph) can be built,
 * and with it the automatic mining of detection rules.
 *
 * A SUBSET of ingestion-service's app/modules/security_rules/languages.py
 * CANONICAL_LANGUAGES: the programming languages the graph is built from.
 * That list is wider, because built-in security rules also exist for
 * languages and file types with no graph (dockerfile, terraform, kubernetes,
 * github-actions, gitlab-ci, docker-compose, sql, html, dart, manifest,
 * firebase-rules, generic). Do not add those here: security rules are served
 * for them whatever this set says.
 */
export const CODE_GRAPH_SUPPORTED_LANGUAGES: ReadonlySet<string> = new Set([
  'python',
  'javascript',
  'typescript',
  'java',
  'go',
  'ruby',
  'php',
  'csharp',
  'c',
  'cpp',
  'kotlin',
  'rust',
  'swift',
  'scala',
  'bash',
]);

/**
 * Raw scanner / aliased language name -> canonical key. Mirrors ingestion's
 * _LANGUAGE_ALIAS plus the scanner-only spellings analysis-reporting stores on
 * detections (jsx/tsx). The combined "JavaScript / TypeScript" spelling is
 * handled by the splitter in normalizeLang().
 */
const LANGUAGE_ALIAS: Record<string, string> = {
  py: 'python',
  python3: 'python',
  js: 'javascript',
  jsx: 'javascript',
  node: 'javascript',
  nodejs: 'javascript',
  ecmascript: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  golang: 'go',
  rb: 'ruby',
  'c#': 'csharp',
  cs: 'csharp',
  '.net': 'csharp',
  dotnet: 'csharp',
  'c++': 'cpp',
  cplusplus: 'cpp',
  cxx: 'cpp',
  kt: 'kotlin',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
};

/** Canonicalise one raw language token, or '' when unrecognised / unsupported. */
const normalizeOne = (raw: string): string => {
  // Drop a parenthetical qualifier like "JavaScript (React)".
  const base = raw.toLowerCase().split('(')[0].trim();
  if (!base) return '';
  if (CODE_GRAPH_SUPPORTED_LANGUAGES.has(base)) return base;
  return LANGUAGE_ALIAS[base] ?? '';
};

/**
 * Expand a raw detection language string into supported canonical tokens.
 * Handles combined spellings such as Bearer's "JavaScript / TypeScript" by
 * splitting on / , ; first. Every returned token is a member of
 * CODE_GRAPH_SUPPORTED_LANGUAGES.
 */
const normalizeLang = (raw: string): string[] =>
  raw
    .split(/[/,;]/)
    .map(normalizeOne)
    .filter((x) => x.length > 0);

/**
 * Whether the project's advanced features (Code Graph + the closed product) should be
 * offered. Optimistic: when no language has been detected yet (empty/undefined)
 * return true so a freshly-created project still shows the tabs. Returns false
 * only when at least one language is known AND none of them is supported.
 */
export const isCodeGraphSupported = (detected?: string[]): boolean => {
  if (!detected || detected.length === 0) return true;
  const langs = detected.flatMap(normalizeLang);
  return langs.some((l) => CODE_GRAPH_SUPPORTED_LANGUAGES.has(l));
};
