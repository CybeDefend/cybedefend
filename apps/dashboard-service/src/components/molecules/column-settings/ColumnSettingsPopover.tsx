import React, { useEffect, useRef, useState } from 'react';
import { Settings2 } from '@/components/atoms/icon/icons';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import { AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';

export interface ColumnToggleItem {
  id: string;
  label: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
}

export interface ColumnSettingsPopoverProps {
  items: ColumnToggleItem[];
  className?: string;
}

const ColumnSettingsPopover: React.FC<ColumnSettingsPopoverProps> = ({
  items,
  className,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative inline-flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] font-medium text-zinc-800 transition-colors duration-[120ms] hover:border-zinc-300',
          'dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:hover:border-white/[0.2]',
          AS_FOCUS,
          AS_TOUCH,
        )}
        title={t('components.resultsTable.columnSettingsTooltip')}
        aria-expanded={open}
      >
        <Settings2 className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
        {t('components.resultsTable.columnSettings')}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-20 mt-2 min-w-[220px] rounded-lg shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_16px_40px_-8px_rgb(0_0_0/0.7)]',
            'bg-white dark:bg-as-raised',
            'border border-zinc-200 dark:border-as-line-strong',
            'p-1 text-zinc-900 dark:text-zinc-100',
          )}
        >
          {items.map((item) => (
            <label
              key={item.id}
              className={cn(
                'relative flex h-8 items-center gap-2 px-2 rounded-md cursor-pointer max-md:h-11',
                'text-[13px] text-zinc-700 dark:text-zinc-300',
                'transition-colors duration-[80ms] hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/[0.06] dark:hover:text-zinc-50',
              )}
            >
              <input
                type="checkbox"
                aria-label={item.label}
                checked={item.checked}
                onChange={(e) => item.onToggle(e.target.checked)}
                className={cn(
                  'h-3.5 w-3.5 rounded-[4px] border-zinc-300 dark:border-white/[0.2] dark:bg-as-raised',
                  'text-secondary focus:ring-secondary focus:ring-offset-0',
                )}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default ColumnSettingsPopover;
