import type { i18n as I18n } from 'i18next';

/**
 * Keeps `<html lang>` on the interface's language: screen readers choose their voice from it,
 * and browsers their hyphenation and translation offer. Set now, then on every change; the
 * returned function stops following.
 */
export function syncDocumentLanguage(i18n: I18n, doc: Document = document): () => void {
  const apply = (language: string | undefined) => {
    if (language) doc.documentElement.setAttribute('lang', language);
  };
  apply(i18n.resolvedLanguage ?? i18n.language);
  const onChange = (language: string) => apply(language);
  i18n.on('languageChanged', onChange);
  return () => i18n.off('languageChanged', onChange);
}
