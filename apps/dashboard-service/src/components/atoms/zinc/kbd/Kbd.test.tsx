import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import Kbd from './Kbd';
import { Kbd as Named } from '.';

describe('Kbd', () => {
  it('renders a <kbd> with the key it names', () => {
    render(<Kbd>Esc</Kbd>);
    const key = screen.getByText('Esc');
    expect(key.tagName).toBe('KBD');
    expect(key.className).toMatch(/font-mono/);
    expect(key.className).toMatch(/dark:/);
  });

  it('is a hairline key in mono 12 px, without a shadow', () => {
    render(<Kbd>/</Kbd>);
    const key = screen.getByText('/');
    expect(key).toHaveClass(
      'font-mono',
      'text-xs',
      'border',
      'border-zinc-200',
      'text-zinc-500',
      'dark:border-vd-line-strong',
      'dark:text-zinc-400',
    );
    expect(key.className).not.toMatch(/shadow|gray-/);
  });

  it('forwards className and attributes, and is exported from the folder', () => {
    render(
      <Named className="ml-2" title="Slash" data-testid="k">
        /
      </Named>,
    );
    const key = screen.getByTestId('k');
    expect(key).toHaveClass('ml-2');
    expect(key).toHaveAttribute('title', 'Slash');
    expect(key).toHaveTextContent('/');
  });
});
