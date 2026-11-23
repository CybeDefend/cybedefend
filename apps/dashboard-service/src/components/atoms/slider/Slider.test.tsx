import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Slider from './Slider';

/**
 * The slider atom: a native range input, so a keyboard
 * and a screen reader get the `slider` role, its bounds and its arrow keys
 * for free; a visible label and a visible value next to it.
 */
const Controlled: React.FC<{ onChange?: (value: number) => void; valueLabel?: (value: number) => string }> = ({
  onChange,
  valueLabel,
}) => {
  const [value, setValue] = useState(3);
  return (
    <Slider
      label="How many seats?"
      description="Pro, 1 to 5"
      min={1}
      max={26}
      value={value}
      valueLabel={valueLabel?.(value)}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
};

describe('Slider', () => {
  it('is a labelled slider with its bounds, its value and its description', () => {
    render(<Controlled />);
    const slider = screen.getByRole('slider', { name: 'How many seats?' });
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '26');
    expect(slider).toHaveValue('3');
    expect(slider).toHaveAccessibleDescription('Pro, 1 to 5');
    expect(screen.getByTestId('slider-value')).toHaveTextContent('3');
  });

  it('reports a number when it moves', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '7' } });
    expect(onChange).toHaveBeenLastCalledWith(7);
    expect(screen.getByTestId('slider-value')).toHaveTextContent('7');
  });

  it('moves with the arrow keys', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const slider = screen.getByRole('slider');
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    // jsdom does not step a range input on a key: the atom does it, as a browser would.
    expect(onChange).toHaveBeenLastCalledWith(4);
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('shows and announces the value label when one is given', () => {
    render(<Controlled valueLabel={(value) => (value >= 26 ? '26+' : String(value))} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '26' } });
    expect(screen.getByTestId('slider-value')).toHaveTextContent('26+');
    expect(slider).toHaveAttribute('aria-valuetext', '26+');
  });
});
