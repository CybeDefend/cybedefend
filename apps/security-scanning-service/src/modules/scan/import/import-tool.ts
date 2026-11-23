/**
 * `scan.importTool` (varchar 255) holds the comma-separated tool list that
 * `CompleteImportScan.tool_name` reports. One tool name is `[a-z0-9._-]{1,64}`.
 *
 * Splits on commas, lower-cases each element, removes every character outside
 * [a-z0-9._-], drops an element that ends up empty, cuts each to 64, joins
 * with ',' and cuts the whole to 255 at an element boundary. An empty result
 * is null.
 */
export function normaliseToolList(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;

  const elements: string[] = [];
  for (const piece of raw.split(',')) {
    const cleaned = piece
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 64);
    if (cleaned) elements.push(cleaned);
  }
  if (elements.length === 0) return null;

  let joined = '';
  for (const element of elements) {
    const candidate = joined ? `${joined},${element}` : element;
    if (candidate.length > 255) break;
    joined = candidate;
  }
  return joined || null;
}
