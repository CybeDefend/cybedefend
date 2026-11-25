import { buildInstallCommand } from './install-command.util';

/**
 * A stored install command, as it may be returned to a caller.
 *
 * The command is shown with a copy button and handed to agents as a command
 * to run, and it was built from package names and versions read from the
 * scanned repository. Rows written by earlier versions may hold any text: a
 * shell sequence, an option, or a URL, git or file source that a package
 * manager fetches instead of a registry package. So a stored command is
 * returned only when it is exactly the command built today from the record's
 * own ecosystem, package and version; anything else is returned empty.
 */
export interface StoredInstallCommandRecord {
  installCommand: string | null;
  ecosystem: string;
  recommendedParentPackage: string | null;
  recommendedProposedVersion: string | null;
}

export function storedInstallCommandForOutput(
  record: StoredInstallCommandRecord,
): string {
  const stored: unknown = record.installCommand;
  if (typeof stored !== 'string' || stored === '') {
    return '';
  }
  const expected = buildInstallCommand(
    record.ecosystem,
    record.recommendedParentPackage,
    record.recommendedProposedVersion,
  );
  return stored === expected ? stored : '';
}
