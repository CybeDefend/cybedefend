import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './copyText';

/**
 * A self-hosted instance served over plain HTTP on a LAN name or IP
 * (`http://host.docker.internal:8080`) is not a secure context: Chrome then
 * exposes no `navigator.clipboard`, and every copy action failed. The helper
 * falls back to a hidden textarea and `document.execCommand('copy')`.
 */
const writeText = vi.fn();
let execCommand: ReturnType<typeof vi.fn>;

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
}
function setSecure(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value });
}

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  execCommand = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
  setClipboard({ writeText });
  setSecure(true);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('copyText', () => {
  it('uses the clipboard API in a secure context', async () => {
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when there is no clipboard API (plain HTTP)', async () => {
    setClipboard(undefined);
    setSecure(false);
    let copiedValue: string | undefined;
    execCommand.mockImplementation(() => {
      copiedValue = (document.activeElement as HTMLTextAreaElement | null)?.value;
      return true;
    });

    await expect(copyText('cybedefend scan --token abc')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(copiedValue).toBe('cybedefend scan --token abc');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('does not use the clipboard API outside a secure context, even when present', async () => {
    setSecure(false);
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when the clipboard API rejects', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    await expect(copyText('hello')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('fails when execCommand answers false, and removes the textarea', async () => {
    setClipboard(undefined);
    execCommand.mockReturnValue(false);
    await expect(copyText('hello')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('fails when execCommand throws, and removes the textarea', async () => {
    setClipboard(undefined);
    execCommand.mockImplementation(() => {
      throw new Error('nope');
    });
    await expect(copyText('hello')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('gives the focus back to the element that had it', async () => {
    setClipboard(undefined);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    await copyText('hello');
    expect(document.activeElement).toBe(button);
  });

  it('never logs the copied text', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    setClipboard(undefined);
    execCommand.mockReturnValue(false);
    await copyText('secret-token');
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});
