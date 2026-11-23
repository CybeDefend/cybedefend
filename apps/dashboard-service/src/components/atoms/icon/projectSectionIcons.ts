import {
  FileText,
  Grid,
  Scale,
  Settings,
  ShieldAlert,
  Sitemap,
} from '@/components/atoms/icon/icons';
import type { IconProps } from '@/components/atoms/icon/icons';
import type React from 'react';
import { PRODUCT_SPACES } from '@/utils/product';

/** Any icon from the registry. */
export type IconComponent = React.ComponentType<IconProps>;

/**
 * One icon per project section, named once.
 *
 * The section nav and each section's own page header used to pick their own:
 * the Overview tab was a grid in the bar and a shield on the panel below it,
 * two glyphs for one destination, a few pixels apart. Same reasoning as
 * `destinationIcons` for the sidebar — two independent lists cannot stay in
 * step, so there is one.
 *
 * A closed space's own tabs draw their glyphs in the closed tree.
 */
export const PROJECT_SECTION_ICONS = {
  overview: Grid,
  vulnerabilities: ShieldAlert,
  'code-graph': Sitemap,
  reports: FileText,
  // A line scale, like the tabs beside it: the solid clipboard read as a second Platform shield at 16 px.
  compliance: Scale,
  settings: Settings,
} satisfies Record<string, IconComponent>;

export type ProjectSectionKey = keyof typeof PROJECT_SECTION_ICONS;

/** A product space's own tab glyph (`ProductSpace.sectionIcons`), or undefined. */
const spaceSectionIcon = (key: string): IconComponent | undefined =>
  PRODUCT_SPACES.map((space) => space.sectionIcons?.[key] as IconComponent | undefined).find(Boolean);

/** Falls back to the overview glyph for a section with no entry. */
export const projectSectionIcon = (key: string): IconComponent =>
  (PROJECT_SECTION_ICONS as Record<string, IconComponent>)[key] ?? spaceSectionIcon(key) ?? Grid;
