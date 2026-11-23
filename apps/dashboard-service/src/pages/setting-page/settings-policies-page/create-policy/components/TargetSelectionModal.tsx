// ============================================================================
// TargetSelectionModal - Modal for selecting teams or projects with pagination
// ============================================================================

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { motion, AnimatePresence } from 'framer-motion';

import { cn } from '@/utils/function/utils';
import Button from '@/components/atoms/button/Button';
import { Check, ChevronLeft, ChevronRight, Search, Times } from '@/components/atoms/icon/icons';

import { AS_PANEL_TITLE, AS_FOCUS, AS_FOCUS_INSET, AS_TOUCH_SQUARE, AS_FIELD, AS_FIELD_FOCUS } from '@/components/atoms/appsec/styles';
interface TargetItem {
  id: string;
  name: string;
  description?: string;
}

interface TargetSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  items: TargetItem[];
  selectedIds: string[];
  onConfirm: (ids: string[], selectedItemsMap: Map<string, string>) => void;
  loading?: boolean;
  searchPlaceholder?: string;
  // Pagination props (for projects)
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

const TargetSelectionModal: React.FC<TargetSelectionModalProps> = ({
  isOpen,
  onClose,
  title,
  items,
  selectedIds,
  onConfirm,
  loading = false,
  searchPlaceholder,
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  searchQuery = '',
  onSearchChange,
}) => {
  const { t } = useTranslation();
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>(selectedIds);
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);
  // Cache to store id -> name mapping for items seen across pages
  const [itemsCache, setItemsCache] = useState<Map<string, string>>(new Map());

  // Sync local state with props
  useEffect(() => {
    setLocalSelectedIds(selectedIds);
  }, [selectedIds]);

  useEffect(() => {
    setLocalSearchQuery(searchQuery);
  }, [searchQuery]);

  // Update cache when items change (new page loaded)
  useEffect(() => {
    if (items.length > 0) {
      setItemsCache((prev) => {
        const newCache = new Map(prev);
        items.forEach((item) => {
          newCache.set(item.id, item.name);
        });
        return newCache;
      });
    }
  }, [items]);

  const handleToggle = (id: string) => {
    setLocalSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    const allIds = items.map((item) => item.id);
    const allSelected = allIds.every((id) => localSelectedIds.includes(id));
    if (allSelected) {
      // Deselect all from current page
      setLocalSelectedIds((prev) => prev.filter((id) => !allIds.includes(id)));
    } else {
      // Select all from current page
      setLocalSelectedIds((prev) => {
        const newSet = new Set([...prev, ...allIds]);
        return Array.from(newSet);
      });
    }
  };

  const handleConfirm = () => {
    // Pass both the selected IDs and the cache of id -> name mappings
    onConfirm(localSelectedIds, itemsCache);
    onClose();
  };

  const handleSearchChange = (value: string) => {
    setLocalSearchQuery(value);
    onSearchChange?.(value);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              className={cn(
                'w-full max-w-lg bg-white dark:bg-as-surface rounded-xl shadow-[0_24px_48px_-16px_rgb(0_0_0/0.18),0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_24px_64px_-12px_rgb(0_0_0/0.85)]',
                'border border-zinc-200 dark:border-as-line-strong'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-as-line">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 flex items-center justify-center">
                    <Check className="h-[18px] w-[18px] text-zinc-500 dark:text-zinc-400"  />
                  </div>
                  <div>
                    <h3 className={AS_PANEL_TITLE}>
                      {title}
                    </h3>
                    <p className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {localSelectedIds.length} {t('common.selected')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className={cn("relative inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200", AS_FOCUS, AS_TOUCH_SQUARE)}
                >
                  <Times className="h-4 w-4"  />
                </button>
              </div>

              {/* Search */}
              <div className="p-4 border-b border-zinc-200 dark:border-as-line">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500"
                   />
                  <input
                    type="text"
                    value={localSearchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder={searchPlaceholder || t('common.search')}
                    className={cn(
                      AS_FIELD, AS_FIELD_FOCUS, 'w-full h-9 pl-8 pr-3 text-sm max-md:h-11'
                    )}
                  />
                </div>
              </div>

              {/* Content */}
              <div className="p-4 max-h-80 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-secondary" />
                  </div>
                ) : items.length === 0 ? (
                  <div className="text-center py-8">
                    <Search
                      className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600 mb-3"
                     />
                    <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
                      {t('common.noResultsFound')}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Select All */}
                    <button
                      onClick={handleSelectAll}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-colors duration-[120ms]', AS_FOCUS_INSET,
                        'bg-zinc-50 dark:bg-white/[0.03] hover:bg-zinc-100 dark:hover:bg-white/[0.06]',
                        'text-sm font-medium text-zinc-700 dark:text-zinc-300'
                      )}
                    >
                      <div
                        className={cn(
                          'h-4 w-4 rounded-[4px] border flex items-center justify-center transition-colors duration-[120ms]',
                          items.every((item) => localSelectedIds.includes(item.id))
                            ? 'bg-secondary border-secondary'
                            : 'border-zinc-300 dark:border-white/[0.2]'
                        )}
                      >
                        {items.every((item) => localSelectedIds.includes(item.id)) && (
                          <Check className="h-3 w-3 text-white"  />
                        )}
                      </div>
                      {t('common.selectAll')}
                    </button>

                    {/* Items List */}
                    <div className="space-y-1">
                      {items.map((item) => {
                        const isSelected = localSelectedIds.includes(item.id);
                        return (
                          <button
                            key={item.id}
                            onClick={() => handleToggle(item.id)}
                            className={cn(
                              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-[120ms] text-left', AS_FOCUS_INSET,
                              isSelected
                                ? 'bg-secondary/[0.04] dark:bg-secondary/[0.08]'
                                : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]'
                            )}
                          >
                            <div
                              className={cn(
                                'h-4 w-4 rounded-[4px] border flex items-center justify-center transition-colors duration-[120ms] flex-shrink-0',
                                isSelected
                                  ? 'bg-secondary border-secondary'
                                  : 'border-zinc-300 dark:border-white/[0.2]'
                              )}
                            >
                              {isSelected && (
                                <Check className="h-3 w-3 text-white"  />
                              )}
                            </div>
                            <span className="text-sm text-zinc-900 dark:text-zinc-100 truncate">
                              {item.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Pagination (for projects) */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 p-4 border-t border-zinc-200 dark:border-as-line">
                  <button
                    onClick={() => onPageChange?.(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className={cn(
                      'relative inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-[120ms]', AS_FOCUS, AS_TOUCH_SQUARE,
                      currentPage <= 1
                        ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                        : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06]'
                    )}
                  >
                    <ChevronLeft className="h-4 w-4"  />
                  </button>
                  <span className="text-[13px] font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => onPageChange?.(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className={cn(
                      'relative inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-[120ms]', AS_FOCUS, AS_TOUCH_SQUARE,
                      currentPage >= totalPages
                        ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                        : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06]'
                    )}
                  >
                    <ChevronRight className="h-4 w-4"  />
                  </button>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 p-4 border-t border-zinc-200 dark:border-as-line">
                <Button variant="ghost" onClick={onClose}>
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" onClick={handleConfirm}>
                  {t('common.confirm')} ({localSelectedIds.length})
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default TargetSelectionModal;
