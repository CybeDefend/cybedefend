/**
 * Hands the viewer a text file built in the page (a CSV, a report): a Blob,
 * an object URL clicked through a created `<a download>`, then the URL
 * revoked on the next tick, once the browser has taken the file.
 */
export function downloadText(text: string, fileName: string, mime = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
