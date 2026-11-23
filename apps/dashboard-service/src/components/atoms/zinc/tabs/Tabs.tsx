import React, { createContext, useCallback, useContext, useId, useMemo, useState } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { motion } from 'framer-motion';
import { Link, type To } from 'react-router-dom';

import { useMotionAllowed } from '@/components/molecules/kit/motion/useMotionAllowed';
import { TOUCH_HIT } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * Text tabs over a hairline: idle zinc-500, the current
 * one in ink with a 1.5 px ink underline that slides to the next tab (framer
 * `layoutId`, ~200 ms spring; it jumps on a calm page).
 *
 * Two forms, one look:
 * - `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` — Radix Tabs: panels
 *   in the page, arrow keys between tabs, `aria-selected`, `aria-controls`.
 * - `LinkTabs` — the sections of a route: router links in a `nav`,
 *   `aria-current="page"` on the current one.
 */
const TRACK = 'relative flex items-center gap-5 border-b border-zinc-200 dark:border-vd-line';
const TAB =
  'relative inline-flex h-9 select-none items-center gap-1.5 whitespace-nowrap rounded-sm text-sm font-medium outline-none transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-iris/80 disabled:pointer-events-none disabled:opacity-40 ' +
  TOUCH_HIT;
const IDLE = 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100';
const CURRENT = 'text-zinc-900 dark:text-zinc-50';
const UNDERLINE = 'absolute inset-x-0 -bottom-px h-[1.5px] rounded-full bg-zinc-900 dark:bg-zinc-100';
const SLIDE = { type: 'spring', stiffness: 520, damping: 42 } as const;

export const TABS_TRACK_CLASSES = TRACK;

function Underline({ layoutId }: { layoutId: string }) {
  const motionAllowed = useMotionAllowed();
  return (
    <motion.span
      aria-hidden="true"
      data-tabs-underline=""
      layoutId={layoutId}
      transition={motionAllowed ? SLIDE : { duration: 0 }}
      className={UNDERLINE}
    />
  );
}

interface TabsState {
  value: string | undefined;
  layoutId: string;
}
const TabsContext = createContext<TabsState | null>(null);

export type TabsProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;

/** Controlled (`value` + `onValueChange`) or not (`defaultValue`), like Radix. */
const Tabs = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Root>, TabsProps>(
  ({ value, defaultValue, onValueChange, ...rest }, ref) => {
    const [inner, setInner] = useState(defaultValue);
    const current = value ?? inner;
    const layoutId = `vd-tabs-${useId()}`;
    const change = useCallback(
      (next: string) => {
        if (value === undefined) setInner(next);
        onValueChange?.(next);
      },
      [value, onValueChange],
    );
    const state = useMemo(() => ({ value: current, layoutId }), [current, layoutId]);
    return (
      <TabsContext.Provider value={state}>
        <TabsPrimitive.Root ref={ref} value={current} onValueChange={change} {...rest} />
      </TabsContext.Provider>
    );
  },
);
Tabs.displayName = 'VdTabs';

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...rest }, ref) => <TabsPrimitive.List ref={ref} className={cn(TRACK, className)} {...rest} />);
TabsList.displayName = 'VdTabsList';

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ value, className, children, ...rest }, ref) => {
  const state = useContext(TabsContext);
  const selected = state?.value === value;
  return (
    <TabsPrimitive.Trigger ref={ref} value={value} className={cn(TAB, selected ? CURRENT : IDLE, className)} {...rest}>
      {children}
      {selected && state ? <Underline layoutId={state.layoutId} /> : null}
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = 'VdTabsTrigger';

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...rest }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('pt-4 outline-none', className)} {...rest} />
));
TabsContent.displayName = 'VdTabsContent';

export interface LinkTabItem {
  value: string;
  label: React.ReactNode;
  to: To;
  testId?: string;
}

export interface LinkTabsProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  items: readonly LinkTabItem[];
  /** The value of the current section. */
  value: string;
  /** Names the navigation. */
  'aria-label': string;
}

function LinkTabs({ items, value, className, ...rest }: LinkTabsProps) {
  const layoutId = `vd-link-tabs-${useId()}`;
  return (
    <nav className={cn(TRACK, className)} {...rest}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <Link
            key={item.value}
            to={item.to}
            data-testid={item.testId}
            aria-current={selected ? 'page' : undefined}
            className={cn(TAB, selected ? CURRENT : IDLE)}
          >
            {item.label}
            {selected ? <Underline layoutId={layoutId} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, LinkTabs };
export default Tabs;
