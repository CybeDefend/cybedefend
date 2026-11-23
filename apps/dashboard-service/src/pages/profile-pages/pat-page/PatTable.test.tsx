import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PatTable from './PatTable';
import type { PersonalAccessTokenView } from '../../../server/interfaces/PersonalAccessToken';

// Minimal i18n shim — return the key so we can assert against translation
// keys directly. Mirrors the pattern used by HomeTemplate.test.tsx.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// FontAwesome ships ESM that vitest occasionally trips on; stub it.
// SECURITY: a list item never carries the secret: the view has no field for it.
const makeToken = (name: string, extra: Partial<PersonalAccessTokenView> = {}): PersonalAccessTokenView => ({
  id: name,
  name,
  lastFour: null,
  createdAt: new Date(1_700_000_000_000).toISOString(),
  lastUsedAt: null,
  expiresAt: null,
  ...extra,
});

describe('PatTable — 10-PAT-per-user UI cap', () => {
  it('shows the X/10 usage indicator', () => {
    const tokens = Array.from({ length: 3 }, (_, i) => makeToken(`tok-${i}`));
    render(
      <PatTable
        tokens={tokens}
        loading={false}
        error={null}
        usage={{ current: 3, max: 10 }}
        onAdd={() => {}}
        onDelete={() => {}}
        onRename={() => {}}
      />,
    );
    expect(screen.getByTestId('pat-usage-indicator')).toHaveTextContent('3/10');
  });

  it('disables the create button when usage.current >= max', () => {
    const tokens = Array.from({ length: 10 }, (_, i) => makeToken(`tok-${i}`));
    const onAdd = vi.fn();
    render(
      <PatTable
        tokens={tokens}
        loading={false}
        error={null}
        usage={{ current: 10, max: 10 }}
        onAdd={onAdd}
        onDelete={() => {}}
        onRename={() => {}}
      />,
    );
    // The wrapper carries the testid so the test stays stable across
    // Button-component refactors; the actual <button> is the child.
    const wrap = screen.getByTestId('pat-create-button-wrap');
    const addButton = wrap.querySelector('button')!;
    expect(addButton).toBeDisabled();
    fireEvent.click(addButton);
    // Even on click, the handler must not fire — defense in depth.
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('keeps the create button enabled below the cap', () => {
    const tokens = Array.from({ length: 9 }, (_, i) => makeToken(`tok-${i}`));
    const onAdd = vi.fn();
    render(
      <PatTable
        tokens={tokens}
        loading={false}
        error={null}
        usage={{ current: 9, max: 10 }}
        onAdd={onAdd}
        onDelete={() => {}}
        onRename={() => {}}
      />,
    );
    const wrap = screen.getByTestId('pat-create-button-wrap');
    const addButton = wrap.querySelector('button')!;
    expect(addButton).not.toBeDisabled();
    fireEvent.click(addButton);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the eye/copy controls for stored tokens (the secret is never present in the list)', () => {
    // SECURITY: the list endpoint never carries the secret value, so
    // show/copy controls would be misleading "reveal an empty string" buttons; they are removed entirely.
    const tokens = [makeToken('ci')];
    render(
      <PatTable
        tokens={tokens}
        loading={false}
        error={null}
        usage={{ current: 1, max: 10 }}
        onAdd={() => {}}
        onDelete={() => {}}
        onRename={() => {}}
      />,
    );
    expect(screen.queryByTitle('components.patTable.show')).not.toBeInTheDocument();
    expect(screen.queryByTitle('components.patTable.copy')).not.toBeInTheDocument();
  });

  it('offers the rename action when it is given one (the cloud)', () => {
    const onRename = vi.fn();
    render(
      <PatTable tokens={[makeToken('ci')]} loading={false} error={null} onAdd={() => {}} onDelete={() => {}} onRename={onRename} />,
    );
    fireEvent.click(screen.getByTitle('components.patTable.rename'));
    expect(onRename).toHaveBeenCalledWith(makeToken('ci'));
    expect(screen.queryByText('components.patTable.lastUsed')).not.toBeInTheDocument();
  });

  it('has no rename action without one (the Community Edition)', () => {
    render(<PatTable tokens={[makeToken('ci')]} loading={false} error={null} onAdd={() => {}} onDelete={() => {}} />);
    expect(screen.queryByTitle('components.patTable.rename')).not.toBeInTheDocument();
    expect(screen.getByText('components.modal.deletePat.title')).toBeInTheDocument();
  });

  it('shows the last four characters and the last use when asked', () => {
    const tokens = [
      makeToken('ci', { id: 'a', lastFour: 'wxyz', lastUsedAt: '2026-10-03T00:00:00.000Z' }),
      makeToken('old', { id: 'b', lastFour: 'abcd' }),
    ];
    render(<PatTable tokens={tokens} loading={false} error={null} showLastUsed onAdd={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('components.patTable.lastUsed')).toBeInTheDocument();
    expect(screen.getByText('…wxyz')).toBeInTheDocument();
    expect(screen.getByText('components.patTable.neverUsed')).toBeInTheDocument();
  });

  it('reads ISO dates and marks an expired token', () => {
    render(
      <PatTable
        tokens={[makeToken('gone', { expiresAt: '2020-01-01T00:00:00.000Z' })]}
        loading={false}
        error={null}
        onAdd={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText('components.patTable.expired')).toBeInTheDocument();
  });
});
