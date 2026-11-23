import React from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "../../atoms/skeleton/Skeleton";
import { useAuth } from "@/edition/auth/useAuth";

interface DropdownHeaderProps {
  email: string;
}

const DropdownHeader: React.FC<DropdownHeaderProps> = ({ email }) => {
  const { loading } = useAuth();
  const { t } = useTranslation();

  return (
    <div className="px-3 py-2.5 border-b border-zinc-200 dark:border-as-line">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("components.appShell.signedInAs")}</p>
      {loading ? (
        <Skeleton type="text" rows={1} width="70%" />
      ) : (
        <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate">
          {email}
        </p>
      )}
    </div>
  );
};

export default DropdownHeader;
