import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import RadioButton from './RadioButton';

// Dark mode regression: the native radio border was `border-gray-300`
// with no paired `dark:` variant.
describe('RadioButton dark mode', () => {
  it('the input border has a paired dark variant', () => {
    const { container } = render(
      <RadioButton name="n" value="v" checked={false} onChange={() => {}} label="L" />,
    );
    const input = container.querySelector('input[type="radio"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.className).toMatch(/\bborder-gray-300\b/);
    expect(input.className).toMatch(/\bdark:border-/);
  });
});

describe('RadioButton disabled and description', () => {
  it('disables the input and names its description for assistive tech', () => {
    const { getByLabelText } = render(
      <RadioButton
        name="n"
        value="v"
        checked={false}
        onChange={() => {}}
        label="Block"
        description="The call is refused."
        disabled
      />,
    );
    const input = getByLabelText('Block') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input).toHaveAccessibleDescription('The call is refused.');
  });
});
