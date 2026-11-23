import { projectSectionIcon } from '@/components/atoms/icon/projectSectionIcons';
import type { IconComponent } from '@/components/atoms/icon/projectSectionIcons';
import { projectPath } from '@/utils/product';
import { CORE_SCANNER_TABS } from '@/components/molecules/wrapper/scannerTabs';
import { EDITION } from '@/edition/edition';

/**
 * The « Current project » section of the AppSec rail: on a project page, the project's tabs as rows of the
 * rail, built by the URL contract the project tab row uses (`projectPath`),
 * never by a hand-written URL. The page's own tab row stays where it is.
 */
export type ProjectSectionKey = 'overview' | 'vulnerabilities' | 'code-graph' | 'reports' | 'compliance' | 'settings';

interface SectionSpec {
  key: ProjectSectionKey;
  /** The URL segment under the project; none for the overview, which is the project's own URL. */
  segment?: string;
  labelKey: string;
}

/** The six AppSec tabs, in the order of `ProjectSectionNav`. */
export const APPSEC_PROJECT_SECTIONS: readonly SectionSpec[] = [
  { key: 'overview', labelKey: 'components.projectWrapper.tabs.overview' },
  { key: 'vulnerabilities', segment: 'sast', labelKey: 'components.projectWrapper.tabs.vulnerabilities' },
  { key: 'code-graph', segment: 'code-graph', labelKey: 'components.projectWrapper.tabs.codeGraph' },
  { key: 'reports', segment: 'reports', labelKey: 'components.projectWrapper.tabs.reports' },
  { key: 'compliance', segment: 'compliance', labelKey: 'components.projectWrapper.tabs.compliance' },
  { key: 'settings', segment: 'settings', labelKey: 'components.projectWrapper.tabs.settings' },
];

/**
 * The core scan-type list segments that belong to « Vulnerabilities » (as in
 * `ProjectSectionNav`): each core scanner tab's key is its URL segment. The
 * closed tree's scanner tabs (the AI-BOM one) arrive as extra segments, passed
 * by the caller from its `project.tabs` slot entries.
 */
const VULN_SEGMENTS: readonly string[] = CORE_SCANNER_TABS.map((tab) => tab.key);

/** An AppSec project page: `/appsec/project/<id>`, with or without a page under it. */
const APPSEC_PROJECT = /^\/appsec\/project\/([^/]+)(?:\/.*)?$/;
/** `/appsec/project/integration/...` are onboarding routes, not a project page. */
const NOT_A_PROJECT_ID = 'integration';
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The project id of an AppSec project page, or null anywhere else or for an id not shaped like one. */
export function appsecProjectIdFromPath(pathname: string): string | null {
  const match = APPSEC_PROJECT.exec(pathname);
  if (!match) return null;
  const id = match[1];
  if (id === NOT_A_PROJECT_ID || !PROJECT_ID.test(id)) return null;
  return id;
}

export interface ProjectSectionLink {
  key: ProjectSectionKey;
  href: string;
  labelKey: string;
  icon: IconComponent;
}

/** The rail's rows for a project: its tabs (six in the cloud) with their URLs and glyphs. */
/** The code map is closed: its page is not in the Community Edition's route table. */
const RAIL_SECTIONS: readonly SectionSpec[] =
  EDITION === 'community'
    ? APPSEC_PROJECT_SECTIONS.filter((section) => section.key !== 'code-graph')
    : APPSEC_PROJECT_SECTIONS;

export const projectSectionLinks = (projectId: string): ProjectSectionLink[] =>
  RAIL_SECTIONS.map((section) => ({
    key: section.key,
    href: projectPath('appsec', projectId, section.segment),
    labelKey: section.labelKey,
    icon: projectSectionIcon(section.key),
  }));

const under = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * The tab of the page, decided as the project tab row decides it; null when
 * the page is none of them. `extraVulnSegments` are the closed tree's
 * scanner-list segments (the `scanner:` `project.tabs` registrations), so a
 * closed scanner's page still marks « Vulnerabilities » in a private build.
 */
export function activeProjectSection(
  pathname: string,
  projectId: string,
  extraVulnSegments: readonly string[] = [],
): ProjectSectionKey | null {
  const base = projectPath('appsec', projectId);
  if (pathname === base || pathname === `${base}/`) return 'overview';
  if ([...VULN_SEGMENTS, ...extraVulnSegments].some((segment) => under(pathname, `${base}/${segment}`))) return 'vulnerabilities';
  const section = APPSEC_PROJECT_SECTIONS.find(
    (candidate) => candidate.segment !== undefined && under(pathname, `${base}/${candidate.segment}`),
  );
  return section ? section.key : null;
}
