import React from 'react';
import { cn } from '@/utils/function/utils';

export interface InlineCodeSegment {
  code: boolean;
  text: string;
}

/** A span between two backticks on one line, at least one character long. */
const SPAN = /`([^`\n]+)`/g;

/**
 * The text of a rule cut into plain text and the code it quotes between
 * backticks (`app.use(requireAuth)`), as Markdown reads inline code. A lone
 * backtick, an empty pair or a span across a line break stays text.
 */
export function splitInlineCode(text: string): InlineCodeSegment[] {
  const segments: InlineCodeSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(SPAN)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ code: false, text: text.slice(last, start) });
    segments.push({ code: true, text: match[1] });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ code: false, text: text.slice(last) });
  return segments;
}

/** Quoted code inside running text: mono on a hairline chip, never a colour. */
export const INLINE_CODE_CHIP =
  'rounded-[5px] border border-zinc-200 bg-zinc-50 px-1 py-px font-mono text-[0.92em] text-zinc-800 [overflow-wrap:anywhere] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-200';

export interface InlineCodeTextProps {
  text: string;
  codeClassName?: string;
}

/** Prints a text with its quoted code as code. Everything stays React text: never markup. */
export const InlineCodeText: React.FC<InlineCodeTextProps> = ({ text, codeClassName }) => (
  <>
    {splitInlineCode(text).map((segment, index) =>
      segment.code ? (
        <code key={index} className={cn(INLINE_CODE_CHIP, codeClassName)}>
          {segment.text}
        </code>
      ) : (
        <React.Fragment key={index}>{segment.text}</React.Fragment>
      ),
    )}
  </>
);

export default InlineCodeText;
