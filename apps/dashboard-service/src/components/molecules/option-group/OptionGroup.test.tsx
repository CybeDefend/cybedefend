import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import OptionGroup from './OptionGroup';

// Dark mode regression: option inputs used `border-gray-300` with no
// paired `dark:` variant.
describe('OptionGroup dark mode', () => {
  it('each option input has a paired dark border', () => {
    const { container } = render(
      <OptionGroup
        name="n"
        type="checkbox"
        selectedValues={['a']}
        options={[{ label: 'A', value: 'a' }]}
        onChange={() => {}}
      />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.className).toMatch(/\bborder-gray-300\b/);
    expect(input.className).toMatch(/\bdark:border-/);
  });
});
