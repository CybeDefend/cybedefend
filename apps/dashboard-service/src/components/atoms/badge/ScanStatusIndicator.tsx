import React from "react";

import { useTranslation } from "react-i18next";
import { Rotate } from '@/components/atoms/icon/icons';

interface ScanStatusIndicatorProps {
    isScanning: boolean;
    className?: string;
}

/**
 * Component to display the current scan status
 * Shows an animated spinner when scanning is active, otherwise shows nothing
 */
const ScanStatusIndicator: React.FC<ScanStatusIndicatorProps> = ({
    isScanning,
    className = "",
}) => {
    const { t } = useTranslation();

    if (!isScanning) {
        return null;
    }

    return (
        <div
            className={`inline-flex items-center justify-center ${className}`}
            role="status"
            aria-live="polite"
        >
            <div className="relative flex items-center justify-center w-8 h-8">
                <Rotate
                    className="relative h-3.5 w-3.5 text-blue-600 dark:text-blue-400 animate-spin"
                    aria-hidden="true"
                 />
            </div>
            <span className="sr-only">
                {t("components.scanStatusIndicator.scanning")}
            </span>
        </div>
    );
};

export default ScanStatusIndicator;