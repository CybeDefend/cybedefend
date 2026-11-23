import React, { useCallback, useId, useState } from 'react';
import { cn } from '@/utils/function/utils';
import Button from '@/components/atoms/button/Button';
import Badge from '@/components/atoms/badge/Badge';
import { ChevronDown } from '@/components/atoms/icon/icons';

export interface CollapsibleCardProps {
  title: React.ReactNode;
  /** Secondary line under the title, announced as the toggle's description. */
  description?: React.ReactNode;
  /** Shown as a small badge next to the title. */
  count?: number;
  /**
   * Header controls (a state switch, a picker). Rendered next to the toggle,
   * never inside it: a control nested in a button is unreachable by keyboard
   * and announced as part of the button.
   */
  control?: React.ReactNode;
  /** Header actions (add, delete…), on the right, outside the toggle as well. */
  actions?: React.ReactNode;
  /** Initial state when uncontrolled. */
  defaultExpanded?: boolean;
  /** Controlled state. Pair with `onExpandedChange`. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** The content. Not rendered while collapsed. */
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * A bordered card whose body folds under a header row: the category groups of
 * the security rules and guards pages.
 *
 * The header is a row, not a button: the toggle (chevron + title + count) is
 * one Button atom with `aria-expanded`/`aria-controls`, and the `control` and
 * `actions` slots sit beside it.
 */
const CollapsibleCard: React.FC<CollapsibleCardProps> = ({
  title,
  description,
  count,
  control,
  actions,
  defaultExpanded = true,
  expanded: expandedProp,
  onExpandedChange,
  children,
  className,
  'data-testid': testId,
}) => {
  const baseId = useId();
  const contentId = `${baseId}-content`;
  const toggleId = `${baseId}-toggle`;
  const descriptionId = `${baseId}-description`;

  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isControlled = expandedProp !== undefined;
  const expanded = isControlled ? expandedProp : internalExpanded;

  const toggle = useCallback(() => {
    const next = !expanded;
    if (!isControlled) setInternalExpanded(next);
    onExpandedChange?.(next);
  }, [expanded, isControlled, onExpandedChange]);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900',
        className,
      )}
      data-testid={testId}
    >
      {/* On a phone the controls go under the title when they do not fit beside
          it: without a floor the title shrank to one letter, or to nothing. */}
      <div
        data-testid="collapsible-card-header"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-gray-50 px-4 py-3 dark:bg-neutral-800/60"
      >
        <div className="min-w-[10rem] flex-1">
          <Button
            id={toggleId}
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-controls={contentId}
            aria-describedby={description ? descriptionId : undefined}
            onClick={toggle}
            className={cn(
              'max-w-full justify-start gap-2 rounded-md p-0 text-left',
              'text-gray-900 hover:bg-transparent hover:text-gray-900',
              'dark:text-gray-100 dark:hover:bg-transparent dark:hover:text-gray-100',
              'active:scale-100 focus:ring-0 focus:ring-offset-0',
              'focus-visible:ring-2 focus-visible:ring-secondary/50',
            )}
          >
            <span
              data-testid="collapsible-card-chevron"
              aria-hidden="true"
              className={cn(
                'inline-flex shrink-0 text-gray-500 transition-transform duration-200 dark:text-gray-400',
                !expanded && '-rotate-90',
              )}
            >
              <ChevronDown className="h-5 w-5" />
            </span>
            <span
              className="min-w-0 truncate text-sm font-semibold"
              title={typeof title === 'string' ? title : undefined}
            >
              {title}
            </span>
            {count !== undefined && (
              <Badge size="xs" data-testid="collapsible-card-count" className="shrink-0">
                {count}
              </Badge>
            )}
          </Button>
          {description && (
            <div id={descriptionId} className="mt-0.5 pl-7 text-xs text-gray-500 dark:text-gray-400">
              {description}
            </div>
          )}
        </div>
        {control && <div className="flex shrink-0 items-center">{control}</div>}
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {expanded && (
        <div
          id={contentId}
          role="region"
          aria-labelledby={toggleId}
          className="border-t border-gray-200 dark:border-neutral-800"
        >
          {children}
        </div>
      )}
    </div>
  );
};

export { CollapsibleCard };
export default CollapsibleCard;
