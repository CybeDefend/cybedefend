import { ACTIVE_EXTENSIONS } from '@/edition/active';
import { readySlots, type SlotName } from '@/edition/slots';

/**
 * The route guard the active edition registers loads its module on demand, at
 * the first page it guards (the app has long loaded it by then). A route-table
 * test that asserts synchronously loads it first, in a `beforeAll`.
 */
export async function loadEditionRouteGuard(): Promise<void> {
  const guard = ACTIVE_EXTENSIONS.ProductRouteGuard as unknown as { ready?: () => Promise<void> } | null;
  await guard?.ready?.();
}

/**
 * The slots the shell itself hosts: `Layout` (overlays, banners), `Header`
 * (header actions), `SidebarContent` (sidebar items) and `RailProjectSection`
 * (project tabs). A page's own slots (project actions, report cards, finding
 * panels, settings sections) are not the shell's: a test that renders a page
 * in the shell loads them itself (`readySlots()`).
 */
export const SHELL_SLOTS: readonly SlotName[] = [
  'app.sidebar.items',
  'app.header.actions',
  'app.shell.overlays',
  'app.banners',
  'project.tabs',
];

/**
 * The shell pieces the active edition registers (each product space's frame,
 * the shell effects and questions, the slots the shell hosts) and its route guard load on
 * demand too. A shell test that
 * asserts synchronously loads them first, in a `beforeAll`. Only the shell's
 * slots: loading every slot evaluated the whole closed tree (report cards,
 * project actions…) in each shell test file, about 10 s, past the hook
 * timeout once the full suite loads the machine.
 */
export async function loadEditionShell(): Promise<void> {
  const onDemandPieces = [
    ACTIVE_EXTENSIONS.ProductRouteGuard,
    ACTIVE_EXTENSIONS.ShellEffects,
    ACTIVE_EXTENSIONS.ShellQuestions,
    ...ACTIVE_EXTENSIONS.products.map((space) => space.Frame),
  ] as unknown as Array<{ ready?: () => Promise<void> } | null | undefined>;
  await Promise.all([...onDemandPieces.map((piece) => piece?.ready?.()), readySlots(SHELL_SLOTS)]);
}
