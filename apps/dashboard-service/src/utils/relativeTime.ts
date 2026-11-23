import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

/**
 * « 12 minutes ago » / « il y a 12 minutes ».
 *
 * Built on `formatDistanceToNow`, what the project rows of the AppSec home
 * already use, with the locale those call sites leave out: `language` is the
 * interface language (`i18n.language`). Any language other than French reads
 * in English, the interface's own fallback. A date that cannot be read gives
 * null, never « Invalid Date ».
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  language: string,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: language.toLowerCase().startsWith('fr') ? fr : undefined,
  });
}
