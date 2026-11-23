const PRIORITY_BRANCHES = ['main', 'master', 'staging', 'dev'];

export function resolveDefaultBranch(
  parsedBranches: { branch: string; lastParsedAt?: string }[],
  referenceBranch?: string,
): string {
  if (!parsedBranches.length) return '';

  if (
    referenceBranch &&
    parsedBranches.some((b) => b.branch === referenceBranch)
  ) {
    return referenceBranch;
  }

  for (const name of PRIORITY_BRANCHES) {
    const found = parsedBranches.find((b) => b.branch === name);
    if (found) return found.branch;
  }

  const sorted = [...parsedBranches].sort(
    (a, b) =>
      new Date(b.lastParsedAt ?? 0).getTime() -
      new Date(a.lastParsedAt ?? 0).getTime(),
  );
  return sorted[0].branch;
}
