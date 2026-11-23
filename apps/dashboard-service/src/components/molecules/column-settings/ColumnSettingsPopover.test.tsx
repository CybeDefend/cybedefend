import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ColumnSettingsPopover from './ColumnSettingsPopover';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => { /* no-op */ } },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'components.resultsTable.columnSettings': 'Columns',
        'components.resultsTable.columnSettingsTooltip': 'Toggle columns',
      };
      return map[key] || key;
    },
  }),
}));

describe('ColumnSettingsPopover', () => {
  const makeItems = () => [
    {
      id: 'epss',
      label: 'Show EPSS column',
      checked: false,
      onToggle: vi.fn(),
    },
  ];

  it('renders the Columns toggle button', () => {
    render(<ColumnSettingsPopover items={makeItems()} />);
    expect(screen.getByRole('button', { name: /Columns/i })).toBeInTheDocument();
  });

  it('keeps the panel hidden until the button is clicked', () => {
    render(<ColumnSettingsPopover items={makeItems()} />);
    expect(screen.queryByText('Show EPSS column')).not.toBeInTheDocument();
  });

  it('opens the panel with the column toggles on button click', () => {
    render(<ColumnSettingsPopover items={makeItems()} />);
    fireEvent.click(screen.getByRole('button', { name: /Columns/i }));
    expect(screen.getByText('Show EPSS column')).toBeInTheDocument();
  });

  it('calls onToggle with the next value when a checkbox is flipped', () => {
    const items = makeItems();
    render(<ColumnSettingsPopover items={items} />);
    fireEvent.click(screen.getByRole('button', { name: /Columns/i }));
    const checkbox = screen.getByRole('checkbox', { name: 'Show EPSS column' });
    fireEvent.click(checkbox);
    expect(items[0].onToggle).toHaveBeenCalledWith(true);
  });

  it('shows the checked state on the checkbox when the item is active', () => {
    const items = [
      {
        id: 'epss',
        label: 'Show EPSS column',
        checked: true,
        onToggle: vi.fn(),
      },
    ];
    render(<ColumnSettingsPopover items={items} />);
    fireEvent.click(screen.getByRole('button', { name: /Columns/i }));
    const checkbox = screen.getByRole('checkbox', {
      name: 'Show EPSS column',
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('renders nothing when items is empty', () => {
    const { container } = render(<ColumnSettingsPopover items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
