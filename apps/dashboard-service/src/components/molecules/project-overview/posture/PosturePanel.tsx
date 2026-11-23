import React from 'react';
import { cn } from '@/utils/function/utils';
import { AS_META, AS_PANEL, AS_PANEL_TITLE } from '@/components/atoms/appsec/styles';
import { EYEBROW_CLASS } from './postureTokens';

interface PosturePanelProps {
  title: string;
  /** One quiet line under the title: what the figures count. */
  meta?: React.ReactNode;
  /** The right side of the title row: export buttons, a segmented control, figures. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** The content runs to the panel's edges (a table whose bands carry their own padding). */
  flush?: boolean;
  className?: string;
  testId?: string;
}

/**
 * One block of the posture briefing: a hairline panel, a title row (title,
 * one quiet line, the actions on the right) and the block's content. Every
 * block of both overview pages is built on it, so the rhythm is one. The
 * panel fills its grid cell and its content column grows, so two blocks side
 * by side end on one line and a block can push its footer to the bottom.
 */
const PosturePanel: React.FC<PosturePanelProps> = ({ title, meta, actions, children, flush, className, testId }) => (
  <section className={cn(AS_PANEL, 'flex h-full min-w-0 flex-col p-4 sm:p-5', className)} data-testid={testId}>
    {/* From sm up the actions keep their place on the right and the title's meta wraps; on a phone they may go under. */}
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2 sm:flex-nowrap">
      <div className="min-w-0 sm:flex-1">
        <h3 className={AS_PANEL_TITLE}>{title}</h3>
        {meta && <p className={cn(AS_META, 'mt-0.5')}>{meta}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
    {flush ? (
      <div className="-mx-4 -mb-4 flex flex-1 flex-col overflow-hidden rounded-b-2xl sm:-mx-5 sm:-mb-5">{children}</div>
    ) : (
      <div className="flex flex-1 flex-col">{children}</div>
    )}
  </section>
);

/**
 * The line that opens a band of the briefing: a small label, a hairline that
 * runs to the right, and optionally the band's actions. One idea per band.
 */
export const BandEyebrow: React.FC<{ label: string; actions?: React.ReactNode; className?: string }> = ({
  label,
  actions,
  className,
}) => (
  <div className={cn('flex items-center gap-3', className)}>
    <h2 className={cn(EYEBROW_CLASS, 'shrink-0')}>{label}</h2>
    <span aria-hidden="true" className="h-px flex-1 bg-zinc-200 dark:bg-as-line" />
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>
);

export default PosturePanel;
