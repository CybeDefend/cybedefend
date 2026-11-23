import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }));

import FileInput from './FileInput';

const classesOf = () => {
  const { container } = render(<FileInput label="Upload a .zip file" onChange={vi.fn()} />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const label = container.querySelector('label') as HTMLLabelElement;
  return { input: input.className.split(/\s+/), label: label.className.split(/\s+/) };
};

/**
 * The native file control, shared by every product space. In the dark theme
 * its « Choose File » button was grey on grey (`neutral-400` on `neutral-700`)
 * and its surface darker than every other field of the same dialog.
 */
describe('FileInput', () => {
  it('reads in the dark theme: the surface, text and border of the Input atom, and a light label on its button', () => {
    const { input, label } = classesOf();

    expect(input).toEqual(expect.arrayContaining(['dark:bg-neutral-800', 'dark:border-neutral-700', 'dark:text-gray-100']));
    // The button of the control: light text on its grey surface.
    expect(input).toEqual(expect.arrayContaining(['dark:file:bg-neutral-700', 'dark:file:text-gray-100']));
    expect(input).not.toContain('dark:file:text-neutral-400');
    expect(input).not.toContain('dark:text-gray-400');
    // Its label reads like the label of the fields next to it.
    expect(label).toContain('dark:text-gray-300');
  });

  it('takes the accent of the space when focused', () => {
    const { input } = classesOf();

    expect(input).toEqual(expect.arrayContaining(['focus:border-secondary', 'focus:ring-secondary']));
    expect(input.join(' ')).not.toContain('scondary');
  });

  it('keeps its light theme as it was', () => {
    const { input, label } = classesOf();
    const light = (classes: string[]) => classes.filter((name) => !name.startsWith('dark:') && !name.startsWith('focus:'));

    expect(light(input)).toEqual([
      'block',
      'w-full',
      'border',
      'border-gray-200',
      'shadow-sm',
      'rounded-lg',
      'text-sm',
      'disabled:opacity-50',
      'disabled:pointer-events-none',
      'file:bg-neutral-50',
      'file:border-0',
      'file:mr-4',
      'file:py-3',
      'file:px-4',
    ]);
    expect(light(label)).toEqual(['block', 'text-sm', 'font-medium', 'text-black', 'mb-1']);
  });
});

/**
 * The SARIF import dialog takes a `.sarif`, `.json` or `.sarif.gz` file and
 * checks it itself: the control hands it any file once `zipOnly` is off. The
 * archive upload keeps its default, a `.zip` only.
 */
describe('FileInput file check', () => {
  const pick = (props: Partial<React.ComponentProps<typeof FileInput>>, file: File) => {
    const onChange = vi.fn();
    const { container } = render(<FileInput label="File" onChange={onChange} {...props} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    return onChange;
  };

  it('refuses anything but a .zip by default', async () => {
    const { toast } = await import('react-toastify');
    const onChange = pick({}, new File(['{}'], 'results.sarif'));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(toast.error).toHaveBeenCalled();
  });

  it('hands any file over when zipOnly is off', async () => {
    const { toast } = await import('react-toastify');
    vi.mocked(toast.error).mockClear();
    const file = new File(['{}'], 'results.sarif');
    const onChange = pick({ zipOnly: false, id: 'import-file' }, file);
    expect(onChange).toHaveBeenCalledWith(file);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('ties its label to its own id', () => {
    const { getByLabelText } = render(<FileInput label="SARIF file" id="import-file" zipOnly={false} onChange={vi.fn()} />);
    expect(getByLabelText('SARIF file')).toHaveAttribute('id', 'import-file');
  });
});
