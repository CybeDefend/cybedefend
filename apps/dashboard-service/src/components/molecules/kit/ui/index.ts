/**
 * The zinc UI kit — ONE import path for every file built on it:
 * `import { Button, Panel, Menu, … } from '@/components/molecules/kit/ui'`.
 *
 * Primitives live in `src/components/atoms/zinc/` (the only place they
 * render native controls); composites live here and are built from them.
 * Style: monochrome zinc, hairlines, Geist, ink as the accent, colour only
 * where it carries meaning. See README.md.
 */

// Primitives
export * from '@/components/atoms/zinc';

// Composites
export { Panel, PANEL_CLASSES, PANEL_TITLE_CLASSES, PANEL_META_CLASSES, type PanelProps, type PanelElement } from './Panel';
export {
  DataList,
  DataRow,
  DATA_LIST_CLASSES,
  DATA_ROW_INNER,
  DATA_ROW_HOVER,
  DATA_ROW_TEXT,
  DATA_ROW_META,
  type DataListProps,
  type DataRowProps,
  type DataRowSize,
} from './DataList';
export {
  SegmentedTabs,
  SEGMENTED_TRACK,
  TABS_TRACK,
  type SegmentedTabsProps,
  type SegmentedTabsOption,
  type SegmentedTabsVariant,
  type SegmentedTabsSize,
} from './SegmentedTabs';
export { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, type TableRowProps, type TableCellProps } from './Table';
export { PageHeader, NarrativePageHeader, PAGE_TITLE_CLASSES, type PageHeaderProps, type NarrativePageHeaderProps } from './PageHeader';
export { Notice, type NoticeProps, type NoticeTone } from './Notice';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioItem,
  MenuRadioGroup,
  MenuGroup,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuSubContent,
  MENU_CONTENT_CLASSES,
  type MenuItemProps,
} from './Menu';
export { Popover, PopoverTrigger, PopoverAnchor, PopoverClose, PopoverContent } from './Popover';
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  Sheet,
  SheetTrigger,
  SheetContent,
  Drawer,
  DrawerTrigger,
  DrawerContent,
  OVERLAY_CLASSES,
  type DialogContentProps,
  type SheetContentProps,
  type ModalContentProps,
} from './Dialog';
export {
  CommandMenu,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  useCommandShortcut,
  type CommandMenuProps,
  type CommandItemProps,
} from './CommandMenu';
export { CommandBlock, type CommandBlockProps } from './CommandBlock';
export { StatStrip, type StatStripProps, type StatStripItem } from './StatStrip';
export { Pagination, type PaginationProps } from './Pagination';
