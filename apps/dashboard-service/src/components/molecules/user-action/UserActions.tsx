import React from "react";
import IconButton from "../../atoms/icon-button/IconButton";
import { useTranslation } from "react-i18next";
import { Bell } from '@/components/atoms/icon/icons';

interface UserActionsProps {
  isDarkMode: boolean;
}

const UserActions: React.FC<UserActionsProps> = ({ isDarkMode }) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-row items-center justify-end gap-1 dark:text-gray-300">
      <IconButton
        icon={Bell}
        label={t('components.userActions.notifications')}
        hoverBgClass="hover:bg-alternative dark:hover:bg-hover-dark"
      />
    </div>
  );
};

export default UserActions;
