import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { KnownProject } from '@/server/services/railSnapshot';
import { cn } from '@/utils/function/utils';
import { projectPath } from '@/utils/product';

import { Folder } from '@/components/atoms/icon/icons';

import { RAIL_EYEBROW, RAIL_GLYPH_IDLE, RAIL_ROW, RAIL_ROW_IDLE } from './railStyles';

interface RailRecentProjectsProps {
  /** The projects to show, already resolved against the loaded list (`pickRecentProjects`). */
  projects: readonly KnownProject[];
}

/**
 * « Recent projects »: the
 * last projects opened in this browser, each a 32 px row: a zinc folder
 * glyph, the name, and the team, quieter, at the row's end, parted by space
 * alone (no separator between facts). No colour: in the
 * rail only the current entry and the product's mark draw the eye. Only what
 * the loaded
 * project list says about each id is printed; the caller leaves out the
 * project of the current page, and the section is not rendered when there
 * is nothing to show.
 */
const RailRecentProjects: React.FC<RailRecentProjectsProps> = ({ projects }) => {
  const { t } = useTranslation();
  const label = t('components.sidebar.recentProjects');
  if (projects.length === 0) return null;

  return (
    <section aria-label={label} data-testid="rail-recent-projects" data-rail-section="recent">
      <p className={RAIL_EYEBROW}>{label}</p>
      <nav aria-label={label} data-rail-rows="" className="space-y-0.5">
        {projects.map((project) => (
          <Link key={project.id} to={projectPath('appsec', project.id)} className={cn(RAIL_ROW, RAIL_ROW_IDLE)}>
            <Folder
              aria-hidden="true"
              strokeWidth={1.5}
              className={cn('h-3.5 w-3.5 shrink-0 transition-colors duration-[120ms]', RAIL_GLYPH_IDLE)}
            />
            <span className="min-w-0 flex-1 truncate" title={project.name}>
              {project.name}
            </span>
            {project.teamName && (
              <span className="max-w-[40%] shrink-0 truncate text-[11px] font-normal leading-4 text-zinc-400" title={project.teamName}>
                {project.teamName}
              </span>
            )}
          </Link>
        ))}
      </nav>
    </section>
  );
};

export default RailRecentProjects;
