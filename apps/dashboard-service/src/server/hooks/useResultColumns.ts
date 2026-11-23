import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { activeExtensions } from '@/edition/active';
import type { ResultColumnExtension } from '@/edition/extensions';

/** A column a results table adds, as the table renders it. */
export interface ResultColumn {
  id: string;
  label: string;
  visible: boolean;
  setVisible(next: boolean): void;
  Cell: ComponentType<{ vulnerability: unknown }>;
}

const NONE_CHOSEN: Record<string, boolean> = {};

/** The stored visibility (`'true'` | `'false'`); anything else, or a storage that refuses, is the column's default. */
function readVisible(extension: ResultColumnExtension, projectId: string): boolean {
  try {
    const stored = window.localStorage.getItem(extension.storageKey(projectId));
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Storage refused (private mode, blocked site data): the default.
  }
  return extension.defaultVisible;
}

function writeVisible(extension: ResultColumnExtension, projectId: string, visible: boolean): void {
  try {
    window.localStorage.setItem(extension.storageKey(projectId), visible ? 'true' : 'false');
  } catch {
    // Storage refused: the choice lasts as long as the page.
  }
}

/**
 * The extra columns of a results table of `vulnerabilityType`, from the
 * active edition's extensions (none in the Community Edition), each shown or
 * hidden per project.
 */
export function useResultColumns(vulnerabilityType: string, projectId: string): ResultColumn[] {
  const { t } = useTranslation();
  const extensions = useMemo(
    () => (activeExtensions().resultColumns ?? []).filter((column) => column.vulnerabilityTypes.includes(vulnerabilityType)),
    [vulnerabilityType],
  );
  const [overrides, setOverrides] = useState<{ projectId: string; visible: Record<string, boolean> }>({
    projectId,
    visible: {},
  });
  const chosen = overrides.projectId === projectId ? overrides.visible : NONE_CHOSEN;

  const setVisible = useCallback(
    (extension: ResultColumnExtension, next: boolean) => {
      writeVisible(extension, projectId, next);
      setOverrides((previous) => ({
        projectId,
        visible: { ...(previous.projectId === projectId ? previous.visible : {}), [extension.id]: next },
      }));
    },
    [projectId],
  );

  return useMemo(
    () =>
      extensions.map((extension) => ({
        id: extension.id,
        label: t(extension.labelKey),
        visible: chosen[extension.id] ?? readVisible(extension, projectId),
        setVisible: (next: boolean) => setVisible(extension, next),
        Cell: extension.Cell,
      })),
    [extensions, chosen, projectId, setVisible, t],
  );
}
