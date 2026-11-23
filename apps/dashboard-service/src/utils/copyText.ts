/**
 * Copies text to the clipboard; resolves true when it landed there.
 *
 * The Clipboard API exists only in a secure context (HTTPS, or localhost).
 * A self-hosted instance is often served over plain HTTP on a LAN name or IP
 * (`http://host.docker.internal:8080`, which local scan pods need): Chrome then
 * exposes no `navigator.clipboard`, and every copy failed. Outside a secure
 * context, or when the API refuses, the text is copied through a temporary
 * off-screen, read-only textarea and `document.execCommand('copy')`.
 *
 * Every copy action goes through here. The text can be a command carrying a
 * token: it is never logged nor shown.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window !== 'undefined' && window.isSecureContext !== false && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (permission, document not focused): try the fallback.
    }
  }
  return copyWithExecCommand(text);
}

function copyWithExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const previousFocus = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const previousRanges: Range[] = [];
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i += 1) previousRanges.push(selection.getRangeAt(i));
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.tabIndex = -1;
  // Off-screen, and 12 px so that iOS does not zoom on focus.
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.style.fontSize = '12pt';

  let ok = false;
  try {
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    ok = typeof document.execCommand === 'function' && document.execCommand('copy') === true;
  } catch {
    ok = false;
  } finally {
    textarea.remove();
    if (selection) {
      try {
        selection.removeAllRanges();
        for (const range of previousRanges) selection.addRange(range);
      } catch {
        // A selection that cannot be restored is left empty.
      }
    }
    if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus !== document.body) {
      previousFocus.focus();
    }
  }
  return ok;
}

export default copyText;
