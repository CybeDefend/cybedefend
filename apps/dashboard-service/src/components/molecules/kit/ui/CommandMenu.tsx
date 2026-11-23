import React, { useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { useTranslation } from 'react-i18next';

import { Search, X } from '@/components/atoms/icon/icons';
import IconButton from '@/components/atoms/zinc/icon-button/IconButton';
import Kbd from '@/components/atoms/zinc/kbd/Kbd';
import Spinner from '@/components/atoms/zinc/spinner/Spinner';
import { FLOATING_SURFACE, HAIRLINE } from '@/components/atoms/zinc/styles';
import { OVERLAY_CLASSES } from '@/components/molecules/kit/ui/Dialog';
import { cn } from '@/utils/function/utils';

/**
 * The command palette (cmdk in a Radix Dialog): opened with ⌘K / Ctrl+K
 * (`useCommandShortcut`), a 15 px search line, groups named in 11 px zinc,
 * 36 px items with a zinc highlight that follows the arrows, Enter runs,
 * Escape closes, focus stays inside. The list's height glides as results
 * change. The footer reminds the keys.
 *
 * Filtering is cmdk's fuzzy match by default. For results fetched as the
 * viewer types, pass `search` + `onSearchChange` and `shouldFilter={false}`
 * and render what the server returned.
 */
export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the dialog for assistive tech. */
  label: string;
  placeholder?: string;
  search?: string;
  onSearchChange?: (search: string) => void;
  shouldFilter?: boolean;
  /** Results on their way: a spinner at the end of the search line. */
  loading?: boolean;
  /** What the list says when nothing matches. Default: "No results." */
  empty?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

function CommandMenu({
  open,
  onOpenChange,
  label,
  placeholder,
  search,
  onSearchChange,
  shouldFilter = true,
  loading = false,
  empty,
  children,
  className,
}: CommandMenuProps) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(OVERLAY_CLASSES, 'grid items-start justify-items-center px-2 pt-2 sm:px-4 md:pt-[12vh]')}>
          <DialogPrimitive.Content
            aria-describedby={undefined}
            data-vd-layer="command"
            className={cn(
              FLOATING_SURFACE,
              'w-full max-w-[640px] overflow-hidden rounded-xl outline-none animate-vd-dialog-in motion-reduce:animate-none',
              className,
            )}
          >
            <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
            <Command label={label} shouldFilter={shouldFilter} loop className="flex flex-col">
              <div className={cn('flex h-12 items-center gap-2.5 border-b px-4', 'border-zinc-200 dark:border-vd-line')}>
                <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                <Command.Input
                  value={search}
                  onValueChange={onSearchChange}
                  placeholder={placeholder}
                  className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[15px] text-zinc-900 shadow-none outline-none placeholder:text-zinc-400 focus:border-0 focus:outline-none focus:ring-0 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
                {loading ? <Spinner size="sm" className="text-zinc-400" /> : <Kbd className="hidden sm:inline-flex">esc</Kbd>}
                {/* No Escape key on a phone: a close button in its place. */}
                <DialogPrimitive.Close asChild>
                  <IconButton
                    aria-label={t('components.kit.close')}
                    icon={<X size={16} strokeWidth={1.5} />}
                    className="-mr-2 shrink-0 sm:hidden"
                  />
                </DialogPrimitive.Close>
              </div>
              <Command.List
                className={cn(
                  'h-[min(var(--cmdk-list-height),min(400px,60vh))] max-md:h-[min(var(--cmdk-list-height),70dvh)] overflow-y-auto overscroll-contain p-1.5 transition-[height] duration-150 ease-out motion-reduce:transition-none',
                  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-zinc-500 dark:[&_[cmdk-group-heading]]:text-zinc-400',
                )}
              >
                <Command.Empty className="px-3 py-8 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
                  {empty ?? t('components.kit.commandEmpty')}
                </Command.Empty>
                {children}
              </Command.List>
              <div
                aria-hidden="true"
                className="hidden h-9 items-center gap-4 border-t border-zinc-200 px-4 text-xs text-zinc-500 dark:border-vd-line dark:text-zinc-400 sm:flex"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd>
                  {t('components.kit.commandNavigate')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>↵</Kbd>
                  {t('components.kit.commandOpen')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>esc</Kbd>
                  {t('components.kit.commandClose')}
                </span>
              </div>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const CommandGroup = React.forwardRef<
  React.ElementRef<typeof Command.Group>,
  React.ComponentPropsWithoutRef<typeof Command.Group>
>(({ className, ...rest }, ref) => <Command.Group ref={ref} className={cn('pb-1', className)} {...rest} />);
CommandGroup.displayName = 'CommandGroup';

export interface CommandItemProps extends React.ComponentPropsWithoutRef<typeof Command.Item> {
  /** A 16 px zinc glyph before the words. */
  icon?: React.ReactNode;
  /** A shortcut or a muted meta after the words. */
  shortcut?: React.ReactNode;
}

export const CommandItem = React.forwardRef<React.ElementRef<typeof Command.Item>, CommandItemProps>(
  ({ icon, shortcut, className, children, ...rest }, ref) => (
    <Command.Item
      ref={ref}
      className={cn(
        'relative flex h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-[13px] max-md:h-11 max-md:text-[15px] text-zinc-700 outline-none transition-colors duration-[60ms]',
        'data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-900 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40',
        'dark:text-zinc-300 dark:data-[selected=true]:bg-white/[0.06] dark:data-[selected=true]:text-zinc-50',
        '[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-zinc-400 dark:[&_svg]:text-zinc-500',
        className,
      )}
      {...rest}
    >
      {icon ? <span aria-hidden="true" className="inline-flex">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? <span className="ml-auto shrink-0 pl-3 max-md:hidden font-mono text-xs text-zinc-500 dark:text-zinc-450">{shortcut}</span> : null}
    </Command.Item>
  ),
);
CommandItem.displayName = 'CommandItem';

export const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof Command.Separator>,
  React.ComponentPropsWithoutRef<typeof Command.Separator>
>(({ className, ...rest }, ref) => <Command.Separator ref={ref} className={cn('-mx-1.5 my-1 h-px', HAIRLINE, className)} {...rest} />);
CommandSeparator.displayName = 'CommandSeparator';

/**
 * Toggles a palette on ⌘K (macOS) / Ctrl+K (elsewhere), wherever the focus
 * is — but not while an IME composes, and not with Shift or Alt held.
 */
export function useCommandShortcut(onToggle: () => void, key = 'k'): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || event.shiftKey || event.altKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== key) return;
      event.preventDefault();
      onToggle();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggle, key]);
}

export { CommandMenu };
export default CommandMenu;
