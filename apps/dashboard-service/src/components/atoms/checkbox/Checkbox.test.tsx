import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Checkbox from './Checkbox';

// Dark mode regression: the native checkbox border was `border-gray-300`
// with no paired `dark:` variant, leaving a light grey border in dark mode.
describe('Checkbox dark mode', () => {
  it('the input border has a paired dark variant', () => {
    const { container } = render(
      <Checkbox name="n" value="v" checked={false} onChange={() => {}} label="L" />,
    );
    const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.className).toMatch(/\bborder-gray-300\b/);
    expect(input.className).toMatch(/\bdark:border-/);
  });
});

describe('Checkbox disabled and description', () => {
  it('disables the input and names its description for assistive tech', () => {
    const { getByLabelText } = render(
      <Checkbox
        name="n"
        value="v"
        checked={false}
        onChange={() => {}}
        label="Strict"
        description="Refuse what cannot be verified."
        disabled
      />,
    );
    const input = getByLabelText('Strict') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input).toHaveAccessibleDescription('Refuse what cannot be verified.');
  });
});
