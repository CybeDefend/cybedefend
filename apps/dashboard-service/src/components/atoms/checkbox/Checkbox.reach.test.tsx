import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Checkbox from './Checkbox';

/**
 * The phone reach of a checkbox is drawn by its label's `::after`. With a
 * word it spans the label and the box on its left. With an empty label (a
 * row's box in a repository table) the label is 0 px wide, so the reach must
 * be a 44 px square centred on the box, or the box keeps its 16 px (verify
 * finding T4a-1).
 */
describe('Checkbox phone reach', () => {
  const props = { name: 'n', value: 'v', checked: false, onChange: () => {} };

  it('spans the label and the box when there is a word', () => {
    const { container } = render(<Checkbox {...props} label="Select" />);
    const label = container.querySelector('label') as HTMLLabelElement;
    expect(label.className).toContain('max-md:after:-left-6');
    expect(label.className).not.toContain('max-md:after:w-11');
  });

  it('is a 44 px square over the box when the label is empty', () => {
    const { container } = render(<Checkbox {...props} label="" />);
    const label = container.querySelector('label') as HTMLLabelElement;
    expect(label.className).toContain('max-md:after:w-11');
    expect(label.className).toContain('max-md:after:h-11');
    expect(label.className).toContain('max-md:after:-left-[38px]');
  });
});
