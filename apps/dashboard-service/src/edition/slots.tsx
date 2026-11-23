import { Fragment, type ReactElement, type ReactNode } from 'react';
import { activeSlots } from './active';

export type SlotName =
  | 'app.sidebar.items'
  | 'app.header.actions'
  | 'app.shell.overlays'
  | 'app.banners'
  | 'project.tabs'
  | 'project.actions'
  | 'project.reports.cards'
  | 'finding.panels'
  | 'finding.actions'
  | 'project.settings.sections'
  | 'settings.organization.tabs'
  | 'settings.profile.tabs'
  | 'upsell'
  | 'finding.scoring'
  | 'finding.sca.remediation'
  | 'project.settings.notifications'
  | 'home.banners';

export interface SlotContext {
  organizationId?: string;
  teamId?: string;
  projectId?: string;
  findingId?: string;
  /** The product space of the page (`useProduct()`). */
  product?: string;
  /** The finding a finding slot is rendered for, as the page holds it. */
  vulnerability?: unknown;
  /** The type of that finding (`sast`, `sca`, …). */
  vulnerabilityType?: string;
  /**
   * Where a `project.actions` slot sits: `header` (the project page's title
   * row, the default) or `inline` (beside an identifier, in a form). Where a
   * `finding.scoring` slot sits (one slot, several spots): `cards` (the score
   * cards, counted to pick the grid), `decomposition` (the rows of the
   * priority decomposition), `exploitability-tag` (the exploitability card's
   * header), `justification` (the verdict's justification). A `finding.scoring`
   * registration decides from the context alone, with no hook, and returns
   * null when it has nothing to show.
   */
  placement?: 'header' | 'inline' | 'cards' | 'decomposition' | 'exploitability-tag' | 'justification';
  /** The priority decomposition a `finding.scoring` slot of placement `decomposition` is rendered in. */
  decomposition?: unknown;
  /** Closes the menu an `app.sidebar.items` entry sits in (the rail's settings menu), when it does. */
  onClose?: () => void;
  /**
   * Which host element renders the slot, when several do (`project.actions`):
   * a registration can show itself in one host only. Absent: every host.
   */
  host?: string;
  /** The project's name, for slots that display it. */
  projectName?: string;
  /**
   * The creation date of the latest scan of the finding's type (a results
   * row, an issue page), null while unknown or while a scan runs.
   */
  lastScanAt?: string | null;
  /** When the project's security context last changed (a results page). */
  securityContextUpdatedAt?: string | null;
  /** The project's latest scan (a results page). */
  scanId?: string | null;
  /** Refetches what the host shows, in the background (a results page, an issue page). */
  onRefresh?: () => void;
  /**
   * The tabs of a host that holds some (an issue page): the tab shown, how to
   * show another, and the tabs a registration withdrew for this page (its
   * data says the tab cannot be shown).
   */
  tabs?: {
    active: string;
    select: (tab: string) => void;
    hidden: readonly string[];
    hide: (tab: string) => void;
  };
  /**
   * The host is drawn in the quick-view drawer rather than as a page
   * (`finding.sca.remediation`: the drawer's compact layout).
   */
  embedded?: boolean;
  /** The organisation statistics the home shows (`home.banners`). */
  statistics?: unknown;
  /** The project payload a settings host loaded (`project.settings.notifications`). */
  project?: unknown;
  /** Whether the organisation's Slack is connected (`project.settings.notifications`). */
  isSlackConnected?: boolean;
  /**
   * The values a settings host holds (`project.settings.sections`), by name,
   * and how a registration changes them: `onChange` receives every value, the
   * changed ones included.
   */
  settings?: {
    values: Record<string, boolean>;
    onChange: (values: Record<string, boolean>) => void;
  };
  /**
   * The content a wrapping registration surrounds (e.g. the `finding.actions`
   * selection tooltip around a finding's text). A host that passes children
   * to `Slot` renders them as-is when the slot has no registration, and each
   * registration receives them here when it has one.
   */
  children?: ReactNode;
  /**
   * The project reports page's host state, handed to the `project.reports.cards`
   * registrations: the shared format and level of detail, the
   * selected branch, and the shared stored-reports drawer the per-card links
   * open.
   */
  reports?: {
    format: 'json' | 'html' | 'pdf';
    detailed: boolean;
    selectedBranch?: string | null;
    openStoredReports: () => void;
    storedReportCount: (kind: string) => number;
  };
}

export interface SlotRegistration {
  slot: SlotName;
  id: string;
  order: number;
  render: (ctx: SlotContext) => ReactNode;
  /**
   * For a registration whose component loads on demand:
   * loads it, so it renders at once. `readySlots` calls every one.
   */
  ready?: () => Promise<void>;
}

/**
 * Loads every registration of the active edition that loads on demand, or,
 * given slot names, only the registrations of those slots. The boot calls it
 * with none; a test that renders a host awaits it before its first render,
 * naming the slots its tree hosts when it does not need every one (each
 * registration's module tree is evaluated again in every test file).
 */
export async function readySlots(only?: readonly SlotName[]): Promise<void> {
  const wanted = only ? new Set<SlotName>(only) : null;
  await Promise.all(activeSlots().map((r) => (wanted && !wanted.has(r.slot) ? undefined : r.ready?.())));
}

/**
 * The registrations of one slot for the active edition, ordered by `order`
 * then `id`. Reads `activeSlots()` from active.ts, so COMMUNITY_SLOTS show in
 * a community build and the ee slots otherwise.
 */
export function useSlotEntries(name: SlotName): SlotRegistration[] {
  return activeSlots()
    .filter((r) => r.slot === name)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * Renders every registration of the slot for the active edition, ordered by
 * `order` then `id`, or nothing when the slot has none. The community build
 * renders COMMUNITY_SLOTS, the others the ee slots (see active.ts).
 *
 * A host may pass `children`: they are handed to each registration through
 * the context (a wrapping registration, like a selection tooltip, renders
 * them), and rendered as-is when the slot has no registration, so a community
 * build keeps the host's content.
 */
export function Slot(props: { name: SlotName; context?: SlotContext; children?: ReactNode }): ReactElement | null {
  const regs = useSlotEntries(props.name);
  if (regs.length === 0) return props.children ? <>{props.children}</> : null;
  const context: SlotContext = { ...(props.context ?? {}), children: props.children };
  return (
    <>
      {regs.map((r) => (
        <Fragment key={r.id}>{r.render(context)}</Fragment>
      ))}
    </>
  );
}
