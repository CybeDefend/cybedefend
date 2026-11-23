import React from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";

import Button from "@/components/atoms/button/Button";
import { cn } from "@/utils/function/utils";
import { Edit, LayerGroup, Xmark } from '@/components/atoms/icon/icons';

interface SelectionActionBarProps {
    /** Number of selected items */
    selectedCount: number;
    /** Maximum allowed selections */
    maxSelections?: number;
    /** Callback when update button is clicked */
    onUpdate: () => void;
    /** Callback to clear all selections */
    onClearSelection: () => void;
    /** Whether the bar is visible */
    isVisible?: boolean;
}

/**
 * SelectionActionBar - Floating action bar that appears when items are selected
 * Provides batch update functionality for selected vulnerabilities
 */
const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
    selectedCount,
    maxSelections = 100,
    onUpdate,
    onClearSelection,
    isVisible = true,
}) => {
    const { t } = useTranslation();

    const isOverLimit = selectedCount > maxSelections;

    return (
        <AnimatePresence>
            {isVisible && selectedCount > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.95 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className={cn(
                        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
                        "flex items-center gap-3 px-3 py-2",
                        "rounded-xl border border-zinc-200 bg-white/95 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.25)] backdrop-blur-md",
                        "dark:border-as-line-strong dark:bg-as-raised/95 dark:shadow-[0_16px_40px_-8px_rgb(0_0_0/0.8)]"
                    )}
                >
                    {/* Selection count badge */}
                    <div className="flex items-center gap-2">
                        <LayerGroup
                            className="h-4 w-4 text-secondary dark:text-secondary-light"
                         />
                        <span className={cn(
                            "font-medium font-mono tabular-nums text-[13px]",
                            isOverLimit ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-100"
                        )}>
                            {selectedCount} {t('common.selected')}
                        </span>
                    </div>

                    {/* Warning if over limit */}
                    {isOverLimit && (
                        <span className="text-xs text-red-500 dark:text-red-400">
                            {t('components.modal.batchUpdate.maxSelectionWarning')}
                        </span>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 ml-2 pl-3 border-l border-zinc-200 dark:border-as-line">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={onUpdate}
                            disabled={isOverLimit}
                            icon={<Edit className="h-3.5 w-3.5"  />}
                            iconPosition="left"
                        >
                            {t('common.update')}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onClearSelection}
                            icon={<Xmark className="h-3.5 w-3.5"  />}
                            iconPosition="left"
                        >
                            {t('common.clear')}
                        </Button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default SelectionActionBar;
