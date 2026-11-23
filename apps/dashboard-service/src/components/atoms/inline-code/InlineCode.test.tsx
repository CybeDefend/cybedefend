import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import InlineCode from './InlineCode';

describe('InlineCode', () => {
  it('renders a <code> chip with its dark variant', () => {
    render(<InlineCode>npm install</InlineCode>);
    const code = screen.getByText('npm install');
    expect(code.tagName).toBe('CODE');
    expect(code).toHaveClass(
      'rounded', 'bg-gray-100', 'px-1', 'py-0.5', 'font-mono', 'text-[0.85em]', 'text-gray-800',
      'dark:bg-neutral-800', 'dark:text-gray-200',
    );
  });

  it('forwards attributes, className and ref', () => {
    const ref = React.createRef<HTMLElement>();
    render(<InlineCode ref={ref} className="break-all" title="cmd" data-testid="c">x</InlineCode>);
    const code = screen.getByTestId('c');
    expect(code).toHaveClass('break-all');
    expect(code).toHaveAttribute('title', 'cmd');
    expect(ref.current).toBe(code);
  });
});
