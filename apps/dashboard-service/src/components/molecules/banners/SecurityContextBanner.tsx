import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Shield } from '@/components/atoms/icon/icons';
import Button from "../../atoms/button/Button";
import { useTranslation } from "react-i18next";
import { projectPath, useProduct } from "@/utils/product";

interface SecurityContextBannerProps {
  projectId: string;
  isCustomized: boolean;
}

const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const getStorageKey = (projectId: string) =>
  `security-context-banner-dismissed-${projectId}`;

const isDismissedRecently = (projectId: string): boolean => {
  const raw = localStorage.getItem(getStorageKey(projectId));
  if (!raw) return false;
  const timestamp = Number(raw);
  if (isNaN(timestamp)) return false;
  return Date.now() - timestamp < DISMISS_DURATION_MS;
};

const SecurityContextBanner: React.FC<SecurityContextBannerProps> = ({
  projectId,
  isCustomized,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const product = useProduct();
  const [dismissed, setDismissed] = useState(() => isDismissedRecently(projectId));

  const handleDismiss = useCallback(() => {
    localStorage.setItem(getStorageKey(projectId), String(Date.now()));
    setDismissed(true);
  }, [projectId]);

  // The settings exist in both product spaces: open the ones of the space the
  // banner is shown in.
  const handleConfigure = useCallback(() => {
    navigate(`${projectPath(product, projectId, 'settings')}?tab=securityContext`);
  }, [navigate, product, projectId]);

  if (isCustomized || dismissed) {
    return null;
  }

  return (
    <div className="mx-4 mb-4 sm:mx-6 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] dark:border-amber-400/20 dark:bg-amber-900/20">
      <div className="flex items-center gap-3">
        <Shield className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-[13px] font-medium text-amber-800 dark:text-amber-300">
            {t('components.securityContextSettings.banner.title')}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300/80">
            {t('components.securityContextSettings.banner.description')}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 ml-4">
        <Button variant="ghost" size="sm" onClick={handleDismiss}>
          {t('components.securityContextSettings.banner.later')}
        </Button>
        <Button variant="primary" size="sm" onClick={handleConfigure}>
          {t('components.securityContextSettings.banner.configure')}
        </Button>
      </div>
    </div>
  );
};

export default SecurityContextBanner;
