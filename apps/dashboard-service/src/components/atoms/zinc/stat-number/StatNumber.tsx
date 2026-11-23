import React from 'react';

import { useTranslation } from 'react-i18next';

import NumberTicker from '@/components/atoms/zinc/number-ticker/NumberTicker';
import UnavailableValue from '@/components/atoms/unavailable-value/UnavailableValue';
import type { Beat } from '@/components/molecules/kit/narrative/beats';
import { cn } from '@/utils/function/utils';

export type StatNumberSize = 'hero' | 'lg' | 'md';

/**
 * A figure told as a sentence: "**6** in the last 7 days". The sentence comes
 * whole from the translation (it carries the plural and the word order of its
 * language); this atom only finds the count inside it and sets it big, so the
 * text a reader (or a test) sees is exactly the sentence, spaces included.
 *
 * The count is found by its digits, whatever group separator the locale wrote
 * (`12,345`, `12 345`, `12.345`). A sentence that does not hold it is shown as
 * is, never with another number made big. An unknown value (`null`) says
 * « Not available » in a small word, and no digit at all: never a zero.
 *
 * The figure is big, light (500), tabular, tight,
 * always in ink (the beat never colours it), and it counts up on first paint
 * through `NumberTicker`, landing on the very digits the sentence wrote.
 */
export interface StatNumberProps extends Omit<React.HTMLAttributes<HTMLParagraphElement>, 'children'> {
  value: number | null;
  /** The translated sentence, holding the formatted count. */
  sentence: string;
  size: StatNumberSize;
  /** The beat the figure tells, set as `data-beat`. It never colours the figure. */
  tone?: Beat;
  /** What a screen reader says in place of the dash when `value` is null. */
  unavailableLabel: string;
}

const numberClasses: Record<StatNumberSize, string> = {
  // 36 px, then 44 px from xl (1440): the landing's three beat tiles (36–44 px / 500).
  hero: 'text-[40px] leading-[1.1] xl:text-[48px] font-medium tracking-[-0.03em] tabular-nums',
  lg: 'text-2xl font-medium tracking-[-0.02em] tabular-nums',
  md: 'text-lg font-medium tracking-[-0.01em] tabular-nums',
};

const INK = 'text-zinc-900 dark:text-zinc-50';
const WORDS = 'text-[13px] text-zinc-500 dark:text-zinc-400';

/** A number as a locale writes it: grouped by thousands with any separator, optionally with decimals. */
const NUMBER_RUN = /\d{1,3}(?:[    ,.'’]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

const digitsOf = (text: string) => text.replace(/\D/g, '');

/** Where the count sits in the sentence: the first number whose digits are the value's. */
export function locateCount(sentence: string, value: number): { start: number; end: number } | null {
  const wanted = digitsOf(String(Math.abs(value)));
  if (!wanted) return null;
  for (const match of sentence.matchAll(NUMBER_RUN)) {
    if (digitsOf(match[0]) === wanted && match.index !== undefined) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

const StatNumber = React.forwardRef<HTMLParagraphElement, StatNumberProps>(
  ({ value, sentence, size, tone, unavailableLabel, className, ...rest }, ref) => {
    const { i18n } = useTranslation();

    if (value === null) {
      return (
        <p ref={ref} data-beat={tone} className={cn('leading-tight', className)} {...rest}>
          <strong className={cn(numberClasses[size], 'text-zinc-500 dark:text-zinc-450')}>
            <UnavailableValue label={unavailableLabel} className="text-sm font-normal tracking-normal" />
          </strong>
        </p>
      );
    }

    const at = locateCount(sentence, value);
    if (!at) {
      return (
        <p ref={ref} data-beat={tone} className={cn('leading-tight', WORDS, className)} {...rest}>
          {sentence}
        </p>
      );
    }

    const before = sentence.slice(0, at.start);
    const written = sentence.slice(at.start, at.end);
    const after = sentence.slice(at.end);
    // The figures on the way up in the interface's language; the last one as the sentence wrote it,
    // grouped by thousands when the sentence printed a bare run of digits (« 3080 » lands on « 3,080 »).
    const landed = /^\d{4,}$/.test(written) ? value.toLocaleString(i18n?.language) : written;
    const format = (n: number) => (n === value ? landed : n.toLocaleString(i18n?.language));
    return (
      <p ref={ref} data-beat={tone} className={cn('leading-tight', className)} {...rest}>
        {before ? <span className={WORDS}>{before}</span> : null}
        <strong className={cn(numberClasses[size], INK)}>
          <NumberTicker value={value} format={format} />
        </strong>
        {after ? <span className={WORDS}>{after}</span> : null}
      </p>
    );
  },
);

StatNumber.displayName = 'StatNumber';

export { StatNumber };
export default StatNumber;
