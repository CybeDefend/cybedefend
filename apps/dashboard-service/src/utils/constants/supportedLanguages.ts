/**
 * Languages CybeDefend's advanced features (the code graph and what reads it)
 * support, in display order. Used ONLY to render the SupportedLanguagesNotice
 * badges/logos — the show/hide DECISION comes from the backend
 * `codeGraphSupported` flag (gateway code-graph-support.util.ts), so this list
 * never drives gating. Mirror of that backend set: the programming languages a
 * code graph is built from, NOT the wider list of security-rule languages
 * (terraform, kubernetes, github-actions, sql, manifest… have rules, no graph).
 */
export const CODE_GRAPH_SUPPORTED_LANGUAGES: string[] = [
  'python', 'javascript', 'typescript', 'java', 'go', 'csharp', 'php',
  'ruby', 'rust', 'kotlin', 'swift', 'scala', 'c', 'cpp', 'bash',
];
