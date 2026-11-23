import React from 'react';
import { cn } from '@/utils/function/utils';
import { useFigures } from './postureTokens';

export interface HeadlinePart {
  value: number;
  /** The words after the figure, already translated and in the right number (« open findings »). */
  label: string;
  /** The word that joins this part to the one before, in place of the comma (« in »). */
  joiner?: string;
}

interface PostureHeadlineProps {
  /** The sentence, figure by figure. An empty list renders no sentence. */
  parts: HeadlinePart[];
  /** What stands where the sentence would be when there is none: a skeleton while the figures load, the page's name without them. */
  placeholder?: React.ReactNode;
  /** The quiet line under the sentence, in the UI font: branch, team, scope written as one phrase. */
  meta?: React.ReactNode;
  /** The controls on the right: branch selector, refresh. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * The first line a reader gets: one sentence built from the figures the page
 * already holds, each figure in mono, the words in ink. Under it, a quiet
 * line of facts in the UI font, written as a phrase with ordinary commas
 * (no hairline, no dot, no mono words). The sentence is composed from parts
 * so each language pluralises its own words; the figures are formatted in the
 * interface's language.
 */
const PostureHeadline: React.FC<PostureHeadlineProps> = ({ parts, placeholder, meta, actions, className }) => {
  const { n } = useFigures();
  return (
    <div className={cn('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        {parts.length > 0 ? (
          <p
            data-testid="posture-headline"
            className="text-xl font-semibold leading-snug tracking-[-0.02em] text-zinc-900 sm:text-[22px] dark:text-zinc-50"
          >
            {parts.map((part, index) => (
              <React.Fragment key={`${part.label}-${index}`}>
                {index > 0 && (part.joiner ? ` ${part.joiner} ` : ', ')}
                <span className="font-mono tabular-nums">{n(part.value)}</span> {part.label}
              </React.Fragment>
            ))}
            .
          </p>
        ) : (
          placeholder
        )}
        {meta && (
          <p className="mt-2 text-[13px] leading-5 text-zinc-500 dark:text-zinc-400">{meta}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
};

export default PostureHeadline;
