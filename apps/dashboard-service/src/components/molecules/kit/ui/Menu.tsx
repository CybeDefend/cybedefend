import React from 'react';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';

import { Check } from '@/components/atoms/icon/icons';
import { FLOATING_MOTION, FLOATING_SURFACE, HAIRLINE, MENU_ITEM } from '@/components/atoms/zinc/styles';
import { cn } from '@/utils/function/utils';

/**
 * A dropdown menu (Radix DropdownMenu: `menu` / `menuitem` roles, arrow keys,
 * typeahead, Escape, focus back to the trigger). The popover is the kit's
 * floating surface — panel colour, hairline, 8 px radius — that scales and
 * fades in from its trigger in 120 ms. Rows are 32 px, an optional 16 px
 * zinc glyph before the words and a mono shortcut hint after them.
 *
 * ```tsx
 * <Menu>
 *   <MenuTrigger asChild><Button variant="ghost">Sort</Button></MenuTrigger>
 *   <MenuContent align="end">
 *     <MenuItem shortcut="⌘N" onSelect={create}>New project</MenuItem>
 *     <MenuSeparator />
 *     <MenuItem tone="danger" onSelect={remove}>Delete</MenuItem>
 *   </MenuContent>
 * </Menu>
 * ```
 */
export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;
export const MenuGroup = MenuPrimitive.Group;
export const MenuRadioGroup = MenuPrimitive.RadioGroup;
export const MenuSub = MenuPrimitive.Sub;

export const MENU_CONTENT_CLASSES = cn(
  FLOATING_SURFACE,
  FLOATING_MOTION,
  'z-[60] min-w-[200px] overflow-hidden p-1 outline-none origin-[var(--radix-dropdown-menu-content-transform-origin)]',
);

export const MenuContent = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Content>
>(({ className, sideOffset = 6, align = 'start', collisionPadding = 8, ...rest }, ref) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      collisionPadding={collisionPadding}
      className={cn(MENU_CONTENT_CLASSES, className)}
      {...rest}
    />
  </MenuPrimitive.Portal>
));
MenuContent.displayName = 'MenuContent';

const Shortcut = ({ children }: { children: React.ReactNode }) => (
  <span className="ml-auto pl-4 font-mono text-xs tracking-wide text-zinc-500 dark:text-zinc-450">{children}</span>
);

export interface MenuItemProps extends React.ComponentPropsWithoutRef<typeof MenuPrimitive.Item> {
  /** A 16 px glyph from the icon registry, before the words. */
  icon?: React.ReactNode;
  /** A shortcut hint after the words (`⌘K`, `G P`). */
  shortcut?: React.ReactNode;
  /** `danger`: the words in red, for the destructive item (last, after a separator). */
  tone?: 'default' | 'danger';
}

export const MenuItem = React.forwardRef<React.ElementRef<typeof MenuPrimitive.Item>, MenuItemProps>(
  ({ icon, shortcut, tone = 'default', asChild, className, children, ...rest }, ref) => (
    <MenuPrimitive.Item
      ref={ref}
      asChild={asChild}
      className={cn(
        MENU_ITEM,
        tone === 'danger' &&
          'text-red-600 data-[highlighted]:text-red-600 dark:text-red-400 dark:data-[highlighted]:text-red-400 [&_svg]:text-current',
        className,
      )}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          {icon ? <span aria-hidden="true" className="inline-flex">{icon}</span> : null}
          <span className="min-w-0 flex-1 truncate">{children}</span>
          {shortcut ? <Shortcut>{shortcut}</Shortcut> : null}
        </>
      )}
    </MenuPrimitive.Item>
  ),
);
MenuItem.displayName = 'MenuItem';

export const MenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.CheckboxItem>
>(({ className, children, ...rest }, ref) => (
  <MenuPrimitive.CheckboxItem ref={ref} className={cn(MENU_ITEM, 'pr-8', className)} {...rest}>
    <span className="min-w-0 flex-1 truncate">{children}</span>
    <MenuPrimitive.ItemIndicator className="absolute right-2 inline-flex text-zinc-900 dark:text-zinc-100">
      <Check aria-hidden="true" size={11} />
    </MenuPrimitive.ItemIndicator>
  </MenuPrimitive.CheckboxItem>
));
MenuCheckboxItem.displayName = 'MenuCheckboxItem';

export const MenuRadioItem = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem>
>(({ className, children, ...rest }, ref) => (
  <MenuPrimitive.RadioItem ref={ref} className={cn(MENU_ITEM, 'pr-8', className)} {...rest}>
    <span className="min-w-0 flex-1 truncate">{children}</span>
    <MenuPrimitive.ItemIndicator className="absolute right-2 inline-flex text-zinc-900 dark:text-zinc-100">
      <Check aria-hidden="true" size={11} />
    </MenuPrimitive.ItemIndicator>
  </MenuPrimitive.RadioItem>
));
MenuRadioItem.displayName = 'MenuRadioItem';

/** A group's name: 11 px zinc-500, sentence case. */
export const MenuLabel = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Label>
>(({ className, ...rest }, ref) => (
  <MenuPrimitive.Label ref={ref} className={cn('px-2 pb-1 pt-2 text-xs font-medium text-zinc-500 dark:text-zinc-400', className)} {...rest} />
));
MenuLabel.displayName = 'MenuLabel';

export const MenuSeparator = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>
>(({ className, ...rest }, ref) => <MenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px', HAIRLINE, className)} {...rest} />);
MenuSeparator.displayName = 'MenuSeparator';

export const MenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.SubTrigger>
>(({ className, ...rest }, ref) => (
  <MenuPrimitive.SubTrigger ref={ref} className={cn(MENU_ITEM, 'data-[state=open]:bg-zinc-100 dark:data-[state=open]:bg-white/[0.06]', className)} {...rest} />
));
MenuSubTrigger.displayName = 'MenuSubTrigger';

export const MenuSubContent = React.forwardRef<
  React.ElementRef<typeof MenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof MenuPrimitive.SubContent>
>(({ className, ...rest }, ref) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.SubContent
      ref={ref}
      sideOffset={4}
      className={cn(MENU_CONTENT_CLASSES, 'origin-[var(--radix-dropdown-menu-content-transform-origin)]', className)}
      {...rest}
    />
  </MenuPrimitive.Portal>
));
MenuSubContent.displayName = 'MenuSubContent';
