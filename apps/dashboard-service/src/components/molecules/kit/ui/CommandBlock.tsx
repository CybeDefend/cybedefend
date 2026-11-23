import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Check, Copy } from '@/components/atoms/icon/icons';
import IconButton from '@/components/atoms/zinc/icon-button/IconButton';
import { cn } from '@/utils/function/utils';
import { copyText } from '@/utils/copyText';

/**
 * A command to run, as a terminal line: a muted `$`, the command in Geist
 * Mono 12.5 px on the subtle fill, a hairline, and a copy button that turns
 * into a check for 1.6 s once the command is on the clipboard. Long commands
 * scroll inside the block, never the page.
 */
export interface CommandBlockProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  command: string;
  /** The prompt glyph; `null` for none (a config snippet). */
  prompt?: string | null;
  /** The copy button's name. Default: "Copy the command". */
  copyLabel?: string;
  onCopied?: () => void;
}

const CommandBlock = React.forwardRef<HTMLDivElement, CommandBlockProps>(
  ({ command, prompt = '$', copyLabel, onCopied, className, ...rest }, ref) => {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);
    const timer = useRef<number | undefined>(undefined);
    useEffect(() => () => window.clearTimeout(timer.current), []);

    const copy = async () => {
      if (await copyText(command)) {
        setCopied(true);
        onCopied?.();
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
      } else {
        setCopied(false);
      }
    };

    return (
      <div
        ref={ref}
        data-command-block=""
        className={cn(
          'flex min-h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 py-1 pl-3 pr-1 dark:border-vd-line dark:bg-vd-bg/70',
          className,
        )}
        {...rest}
      >
        {prompt ? (
          <span aria-hidden="true" className="select-none font-mono text-[12.5px] text-zinc-400 dark:text-zinc-500">
            {prompt}
          </span>
        ) : null}
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre py-1.5 font-mono text-[12.5px] leading-5 text-zinc-900 [scrollbar-width:none] dark:text-zinc-100">
          {command}
        </code>
        <IconButton
          size="sm"
          aria-label={copied ? t('components.kit.copied') : copyLabel ?? t('components.kit.copyCommand')}
          tooltip={copied ? t('components.kit.copied') : t('components.kit.copy')}
          icon={copied ? <Check size={12} /> : <Copy size={13} />}
          onClick={copy}
        />
        <span aria-live="polite" className="sr-only">
          {copied ? t('components.kit.copied') : ''}
        </span>
      </div>
    );
  },
);

CommandBlock.displayName = 'CommandBlock';

export { CommandBlock };
export default CommandBlock;
