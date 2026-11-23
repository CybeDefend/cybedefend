import { AS_WORD_TONE } from '@/components/atoms/appsec/styles';

/**
 * Colour carried by a word, where a 6 px dot used to carry it (no data
 * dots). « Critical » is written in red,
 * « Resolved » in green: the word itself is the information. One source for
 * every AppSec screen: the shared atoms' `AS_WORD_TONE`
 * (`atoms/appsec/styles.ts`), where each shade's contrast is written down.
 */
export const WORD_TONE = AS_WORD_TONE;

export type WordTone = keyof typeof WORD_TONE;

/** The tone of a severity word, whatever case the source gives it (`CRITICAL`, `high`…). */
export function severityTone(severity: string | null | undefined): WordTone {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'neutral';
  }
}
