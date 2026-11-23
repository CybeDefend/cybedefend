import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';

import { X } from '@/components/atoms/icon/icons';
import IconButton from '@/components/atoms/zinc/icon-button/IconButton';
import { cn } from '@/utils/function/utils';

/**
 * Modal layers of the zinc kit, all on Radix Dialog (focus trapped,
 * Escape and an outside click close, focus back to the trigger, the page
 * behind inert and unscrollable):
 *
 * - `DialogContent` — a centred 12 px-radius panel high on the page, rising
 *   8 px in 160 ms. For a confirmation, a short form.
 * - `SheetContent` — from the bottom edge on a phone (`full` for the whole
 *   screen: the mobile menu of the shell).
 * - `DrawerContent` — from the right, flush with the top, right and bottom
 *   edges, a hairline on its left, 240 ms on the sheet curve. A record's
 *   detail opens in the shared `SideSheet` (atoms/side-sheet), which also
 *   slides out and serves both spaces: prefer it (never a
 *   floating card).
 *
 * The overlay is black at 40 % with a small blur. It never fades in from
 * opacity 0 (a frozen first frame would leave an invisible trap): its colour
 * eases in from transparent, and the panel moves by transform only.
 *
 * Every layer carries a title (`hideTitle` keeps it for screen readers
 * only), an optional description, the close button, the body and an
 * optional footer of actions on a hairline.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;

type Layout = 'dialog' | 'sheet' | 'sheet-full' | 'drawer';

export interface ModalContentProps extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Keep the title for assistive tech only. */
  hideTitle?: boolean;
  /** Actions, right-aligned on a hairline: the primary one last. */
  footer?: React.ReactNode;
  hideClose?: boolean;
  /** Classes of the body wrapper. */
  bodyClassName?: string;
}

export const OVERLAY_CLASSES =
  'fixed inset-0 z-[65] bg-black/40 backdrop-blur-sm animate-backdrop-in motion-reduce:animate-none';

const OVERLAY_LAYOUT: Record<Layout, string> = {
  dialog: 'grid items-start justify-items-center overflow-y-auto px-4 pb-8 pt-[10vh]',
  sheet: 'flex items-end',
  'sheet-full': 'flex',
  drawer: 'flex justify-end',
};

const SURFACE = 'relative flex flex-col bg-white text-zinc-900 outline-none dark:bg-vd-surface dark:text-zinc-100';
/** A layer above the page: a soft drop shadow, and in dark the plate's 1 px top highlight over a deep one. */
const LIFT =
  'shadow-[0_24px_48px_-16px_rgb(0_0_0/0.18),0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_24px_64px_-12px_rgb(0_0_0/0.85)]';
const EDGE = 'border border-zinc-200 dark:border-vd-line-strong';

const CONTENT_LAYOUT: Record<Layout, string> = {
  dialog: cn(SURFACE, EDGE, LIFT, 'w-full rounded-xl animate-vd-dialog-in motion-reduce:animate-none'),
  sheet: cn(SURFACE, 'max-h-[92dvh] w-full rounded-t-xl border-t border-zinc-200 pb-[env(safe-area-inset-bottom)] dark:border-vd-line-strong dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05)] animate-sheet-up motion-reduce:animate-none'),
  'sheet-full': cn(SURFACE, 'h-full w-full pb-[env(safe-area-inset-bottom)] animate-vd-dialog-in motion-reduce:animate-none'),
  drawer: cn(
    SURFACE,
    'h-full w-full border-zinc-200 sm:w-[520px] sm:max-w-full sm:border-l dark:border-vd-line-strong animate-vd-drawer-in motion-reduce:animate-none',
  ),
};

const DIALOG_WIDTH = { sm: 'max-w-[400px]', md: 'max-w-[480px]', lg: 'max-w-[640px]' } as const;

const ModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ModalContentProps & { layout: Layout; width?: keyof typeof DIALOG_WIDTH }
>(({ layout, width = 'md', title, description, hideTitle = false, footer, hideClose = false, bodyClassName, className, children, ...rest }, ref) => {
  const { t } = useTranslation();
  const scrollsInside = layout !== 'dialog';
  return (
    <DialogPrimitive.Portal>
      {/* The overlay wraps the panel: one scroll container, and an outside click is a click on it. */}
      <DialogPrimitive.Overlay data-vd-overlay={layout} className={cn(OVERLAY_CLASSES, OVERLAY_LAYOUT[layout])}>
        <DialogPrimitive.Content
          ref={ref}
          data-vd-layer={layout}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(CONTENT_LAYOUT[layout], layout === 'dialog' && DIALOG_WIDTH[width], className)}
          {...rest}
        >
          <div
            className={cn(
              'flex shrink-0 items-start justify-between gap-4 px-5',
              hideTitle ? 'absolute right-0 top-0 pt-3 pr-3' : 'pt-4',
            )}
          >
            <div className={cn('min-w-0', hideTitle && 'sr-only')}>
              <DialogPrimitive.Title className="text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-50">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-sm leading-5 text-zinc-500 dark:text-zinc-400">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            {hideClose ? null : (
              <DialogPrimitive.Close asChild>
                <IconButton size={layout === 'sheet-full' ? 'md' : 'sm'} aria-label={t('components.kit.close')} icon={<X size={16} strokeWidth={1.5} />} className="-mr-1.5 -mt-0.5" />
              </DialogPrimitive.Close>
            )}
          </div>
          <div className={cn('px-5 pb-5 pt-3 text-sm', scrollsInside && 'min-h-0 flex-1 overflow-y-auto overscroll-contain', bodyClassName)}>
            {children}
          </div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-vd-line">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  );
});
ModalContent.displayName = 'ModalContent';

export interface DialogContentProps extends ModalContentProps {
  /** `sm` 400 px, `md` 480 px (default), `lg` 640 px. */
  width?: keyof typeof DIALOG_WIDTH;
}

export const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  (props, ref) => <ModalContent ref={ref} layout="dialog" {...props} />,
);
DialogContent.displayName = 'DialogContent';

export interface SheetContentProps extends ModalContentProps {
  /** The whole screen instead of a bottom sheet. */
  full?: boolean;
}

export const SheetContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  ({ full = false, ...props }, ref) => <ModalContent ref={ref} layout={full ? 'sheet-full' : 'sheet'} {...props} />,
);
SheetContent.displayName = 'SheetContent';

export const DrawerContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, ModalContentProps>(
  (props, ref) => <ModalContent ref={ref} layout="drawer" {...props} />,
);
DrawerContent.displayName = 'DrawerContent';
