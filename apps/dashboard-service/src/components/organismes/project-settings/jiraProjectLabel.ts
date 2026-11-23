/**
 * A Jira project as the Issues settings name it: « Security (SEC) », the name
 * first and its key in brackets after it, no separator
 * glyph between the two. Either part alone when the other is unknown.
 */
export function jiraProjectLabel(key: string | undefined, name: string | undefined): string {
  const k = key?.trim() ?? '';
  const n = name?.trim() ?? '';
  if (!k) return n;
  if (!n || n === k) return k;
  return `${n} (${k})`;
}
