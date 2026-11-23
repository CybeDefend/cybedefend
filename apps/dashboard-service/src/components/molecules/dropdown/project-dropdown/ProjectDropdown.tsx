import React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { projectPath } from "@/utils/product";
import { ChartBar, Cog, Eye } from '@/components/atoms/icon/icons';
import { PROJECT_SECTION_ICONS } from '@/components/atoms/icon/projectSectionIcons';
import type { IconProps } from '@/components/atoms/icon/icons';

/** Any icon from the registry: a component taking the shared icon props. */
type IconComponent = React.ComponentType<IconProps>;

interface ProjectDropdownProps {
  projectId: string;
}

interface DropdownMenuItemProps {
  icon: IconComponent;
  label: string;
  to: string;
  description?: string;
}

const DropdownMenuItem: React.FC<DropdownMenuItemProps> = ({ icon, label, to, description }) => (
  <Link
    to={to}
    className="
      w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
      text-left transition-all duration-150
      text-gray-700 dark:text-gray-200
      hover:bg-gray-100 dark:hover:bg-neutral-700/50
      active:bg-gray-200 dark:active:bg-neutral-700
      group
    "
  >
    <div className="
      flex items-center justify-center w-8 h-8 rounded-lg
      bg-gray-100 dark:bg-neutral-700
      group-hover:bg-primary/10 group-hover:text-primary
      dark:group-hover:bg-primary/20 dark:group-hover:text-primary
      transition-colors duration-150
    ">
      {React.createElement(icon, { className: "w-3.5 h-3.5" })}
    </div>
    <div className="flex-1 min-w-0">
      <span className="block text-sm font-medium truncate">{label}</span>
      {description && (
        <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
          {description}
        </span>
      )}
    </div>
  </Link>
);

const ProjectDropdown: React.FC<ProjectDropdownProps> = ({ projectId }) => {
  const { t } = useTranslation();

  return (
    <div className="
      w-64 py-2
      bg-white dark:bg-neutral-800
      border border-gray-200 dark:border-neutral-700
      rounded-xl shadow-xl
      ring-1 ring-black/5 dark:ring-white/5
    ">
      {/* Header Section */}
      <div className="px-3 pb-2">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
          {t('navigation.general')}
        </span>
      </div>

      {/* General Actions */}
      <div className="px-1.5 space-y-0.5">
        <DropdownMenuItem
          icon={Eye}
          label={t('navigation.overview')}
          description={t('navigation.viewProjectDetails')}
          to={projectPath('appsec', projectId)}
        />
        <DropdownMenuItem
          icon={ChartBar}
          label={t('navigation.viewReports')}
          description={t('navigation.analysisReports')}
          to={projectPath('appsec', projectId, 'reports')}
        />
        <DropdownMenuItem
          icon={PROJECT_SECTION_ICONS.compliance}
          label={t('navigation.compliance')}
          description={t('navigation.policyCompliance')}
          to={projectPath('appsec', projectId, 'compliance')}
        />
      </div>

      {/* Divider */}
      <div className="my-2 mx-3 border-t border-gray-200 dark:border-neutral-700" />

      {/* Settings Section */}
      <div className="px-3 pb-2">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
          {t('navigation.configuration')}
        </span>
      </div>

      <div className="px-1.5 space-y-0.5">
        <DropdownMenuItem
          icon={Cog}
          label={t('navigation.settings')}
          description={t('navigation.projectSettings')}
          to={projectPath('appsec', projectId, 'settings')}
        />
      </div>
    </div>
  );
};

export default ProjectDropdown;
