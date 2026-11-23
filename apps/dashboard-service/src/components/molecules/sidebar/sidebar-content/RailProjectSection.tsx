import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Folder } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';

import { activeProjectSection, projectSectionLinks } from './projectRail';
import { useSlotEntries } from '@/edition/slots';
import { isScannerTabEntry, scannerTabSegment } from '@/components/molecules/wrapper/scannerTabs';
import {
  RAIL_EYEBROW,
  RAIL_GLYPH_ACTIVE,
  RAIL_GLYPH_IDLE,
  RAIL_ROW_ACTIVE,
  RAIL_ROW_IDLE,
  RAIL_TAB_MARKER,
  RAIL_TAB_ROW,
} from './railStyles';

interface RailProjectSectionProps {
  projectId: string;
  pathname: string;
  /** The project's name, as the page published it for the breadcrumb; null until it has. */
  name: string | null;
}

/**
 * « Current project »: on a
 * project page, the project's name and its six tabs as 28 px rows, built by
 * the URL contract the project tab row uses. The page's own tab row stays
 * where it is; this is the rail saying where you are, one glance away from
 * the navigation. The current tab keeps the rail's wash and its accent bar,
 * never a colour alone (`aria-current` says it too).
 */
const RailProjectSection: React.FC<RailProjectSectionProps> = ({ projectId, pathname, name }) => {
  const { t } = useTranslation();
  // The closed tree's scanner-list tabs (the AI-BOM one) also mark « Vulnerabilities ».
  const extraVulnSegments = useSlotEntries('project.tabs')
    .filter(isScannerTabEntry)
    .map((entry) => scannerTabSegment(entry.id));
  const activeKey = activeProjectSection(pathname, projectId, extraVulnSegments);
  const label = t('components.sidebar.currentProject');

  return (
    <section aria-label={label} data-testid="rail-current-project" data-rail-section="project">
      {/* The project's name heads its tabs; the « Current project » eyebrow
          stands in for it only until the page has published it. One header,
          not two: the rail has no pixel to spare (the rail never scrolls). */}
      {name ? (
        <p className="flex min-h-7 items-center gap-2.5 px-2.5 text-[12px] font-medium leading-5 text-white">
          <Folder aria-hidden="true" strokeWidth={1.5} className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <span className="min-w-0 truncate" title={name}>
            {name}
          </span>
        </p>
      ) : (
        <p className={RAIL_EYEBROW}>{label}</p>
      )}
      <nav aria-label={label} className="space-y-0.5">
        {projectSectionLinks(projectId).map(({ key, href, labelKey, icon: Icon }) => {
          const active = key === activeKey;
          return (
            <Link
              key={key}
              to={href}
              aria-current={active ? 'page' : undefined}
              className={cn(RAIL_TAB_ROW, active ? RAIL_ROW_ACTIVE : RAIL_ROW_IDLE)}
            >
              {active && <span aria-hidden="true" className={RAIL_TAB_MARKER} />}
              <Icon
                aria-hidden="true"
                className={cn('h-3.5 w-3.5 shrink-0 transition-colors duration-[120ms]', active ? RAIL_GLYPH_ACTIVE : RAIL_GLYPH_IDLE)}
              />
              <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </section>
  );
};

export default RailProjectSection;
