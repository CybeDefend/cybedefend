import { describe, it, expect } from 'vitest';
import { SCAN_SOURCES, isKnownScanSource, scanSourceLabelKey } from './scanSource';

describe('scanSourceLabelKey', () => {
  // The six values global-management stores in `project.lastScanSourceType`
  // (`ScanSourceType`, migration 1765750438168). The dashboard knew four of
  // them: a project last scanned from the VS Code extension showed the raw key
  // « components.scanSourceBadge.vscode » in the Platform project list.
  it.each([
    ['manual', 'components.scanSourceBadge.manual'],
    ['cli', 'components.scanSourceBadge.cli'],
    ['github', 'components.scanSourceBadge.github'],
    ['gitlab', 'components.scanSourceBadge.gitlab'],
    ['jetbrains', 'components.scanSourceBadge.jetbrains'],
    ['vscode', 'components.scanSourceBadge.vscode'],
  ])('names the known source %s', (source, key) => {
    expect(scanSourceLabelKey(source)).toBe(key);
  });

  it('knows every source the backend stores', () => {
    expect([...SCAN_SOURCES].sort()).toEqual(['cli', 'github', 'gitlab', 'jetbrains', 'manual', 'vscode']);
  });

  // The API sends a plain string: a source added on the backend before the
  // dashboard learns it reads « Other source », never a dotted key.
  it.each([['bitbucket'], ['VSCODE'], [''], [null], [undefined], ['__proto__'], ['toString']])(
    'names an unknown source %s as another source',
    (source) => {
      expect(scanSourceLabelKey(source as string | null | undefined)).toBe('components.scanSourceBadge.other');
    },
  );
});

describe('isKnownScanSource', () => {
  it('accepts the known sources only', () => {
    expect(isKnownScanSource('vscode')).toBe(true);
    expect(isKnownScanSource('jetbrains')).toBe(true);
    expect(isKnownScanSource('bitbucket')).toBe(false);
    expect(isKnownScanSource(undefined)).toBe(false);
    expect(isKnownScanSource(42)).toBe(false);
  });
});
