import React from 'react';
import ProjectSectionNav from './ProjectSectionNav';
import { usePublishProjectName } from '@/components/molecules/breadcrumbs/BreadcrumbProjectContext';
import ProjectIdActions from '../project-id-actions/ProjectIdActions';
import { spaceOf, useProduct } from '@/utils/product';
import { AS_PAGE_TITLE } from '@/components/atoms/appsec/styles';

interface ProjectTemplateWrapperProps {
  projectId: string | undefined;
  projectTitle: string;
  selectedTab: string;
  children: React.ReactNode;
  /**
   * Page-level actions, rendered on the title row.
   *
   * `AnalyseWrapper` puts "Start analysis" here on the vulnerability tabs, so
   * without a matching slot the project's primary action appeared and vanished
   * as you moved between tabs of the same project.
   */
  actions?: React.ReactNode;
  /**
   * A line under the title row, inside the header band: the agents project
   * page puts its pulse strip here. Nothing is rendered without one.
   */
  subheader?: React.ReactNode;
}

/*
  The header band and the project name, by the skin of the space. The
  Platform keeps today's white band and 30 px title, byte for byte. The zinc
  skin sits on the page, with no rule of its own (the
  tab row under it draws the one hairline), and names the project like every
  page title of its space: 22 px, 600, tight, in ink.
*/
/** The page under the project: the space's own surface, AppSec's untouched. */
const ROOT = {
  appsec: 'min-h-screen',
  zinc: 'min-h-screen bg-transparent',
} as const;
const BAND = {
  appsec: 'bg-white dark:bg-as-surface px-4 pt-5 pb-3 sm:px-6',
  // Below `md` the shell's 16 px gutter and top space are the page's: none added here.
  zinc: 'bg-transparent pb-3 md:px-6 md:pt-6',
} as const;
/** The tab's content under the band. */
const CONTENT = {
  appsec: 'px-4 py-6 sm:p-6',
  zinc: 'py-6 md:p-6',
} as const;
const TITLE = {
  appsec: `${AS_PAGE_TITLE} truncate`,
  zinc: 'text-[22px] font-semibold leading-7 tracking-[-0.02em] text-zinc-900 dark:text-zinc-50 truncate',
} as const;

const ProjectTemplateWrapper: React.FC<ProjectTemplateWrapperProps> = ({
  projectId,
  projectTitle,
  selectedTab,
  children,
  actions,
  subheader,
}) => {
  // The breadcrumb only knows the URL; give it the project's name.
  usePublishProjectName(projectTitle);
  const product = useProduct();
  const skin = spaceOf(product).skin === 'zinc' ? 'zinc' : 'appsec';

  return (
    <div className={ROOT[skin]}>
      {/* Full-bleed white header — same surface and section nav as the
          vulnerability list pages so every project page reads identically. */}
      {/* 16px gutters on a phone, as the rest of the shell; 24px from `sm` up. */}
      <div className={BAND[skin]}>
        {/* On a phone the page actions go under the title: on one row, a
            French « Démarrer l'analyse » left the project name 80px. From
            `sm` up they sit beside it and keep their width; the name is what
            is cut. The title takes the row (`sm:flex-auto`): the project name
            first, then the project's actions (a state pill) in what is left. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-2 sm:flex-auto">
            <h1 className={TITLE[skin]} title={projectTitle}>
              {projectTitle}
            </h1>
            {projectId && <ProjectIdActions projectId={projectId} />}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2 sm:ml-auto">{actions}</div>
          )}
        </div>
        {subheader && <div className="mt-3">{subheader}</div>}
      </div>

      <ProjectSectionNav projectId={projectId} active={selectedTab} />

      <div className={CONTENT[skin]}>{children}</div>
    </div>
  );
};

export default ProjectTemplateWrapper;
