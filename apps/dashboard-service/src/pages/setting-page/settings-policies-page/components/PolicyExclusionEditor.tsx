// ============================================================================
// PolicyExclusionEditor - Editor component for policy exclusions
// ============================================================================

import React from 'react';
import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';

import { PolicyExclusion } from '@/server/interfaces/Policy';
import { cn } from '@/utils/function/utils';
import Input from '@/components/atoms/input/Input';
import { Trash } from '@/components/atoms/icon/icons';

import { AS_FOCUS, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';
interface PolicyExclusionEditorProps {
  exclusion: PolicyExclusion;
  index: number;
  onChange: (exclusion: PolicyExclusion) => void;
  onRemove: () => void;
}

const PolicyExclusionEditor: React.FC<PolicyExclusionEditorProps> = ({
  exclusion,
  index,
  onChange,
  onRemove,
}) => {
  const { t } = useTranslation();

  const handleChange = (field: keyof PolicyExclusion, value: string | string[] | undefined) => {
    onChange({ ...exclusion, [field]: value });
  };

  return (
    <div
      className={cn(
        'border rounded-xl p-4 transition-colors duration-[120ms]',
        'border-zinc-200 dark:border-as-line',
        'bg-zinc-50 dark:bg-white/[0.03]'
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {t('pages.policies.exclusions.exclusion')} #{index + 1}
        </span>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onRemove}
          className={cn(
            'relative inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-[120ms]', AS_FOCUS, AS_TOUCH_SQUARE,
            'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
          )}
        >
          <Trash className="h-4 w-4"  />
        </motion.button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label={t('pages.policies.exclusions.pattern')}
            value={exclusion.pattern}
            onChange={(e) => handleChange('pattern', e.target.value)}
            placeholder={t('pages.policies.exclusions.patternPlaceholder')}
            required
          />

          <Input
            label={t('pages.policies.exclusions.expirationDate')}
            type="date"
            value={exclusion.expirationDate ? exclusion.expirationDate.split('T')[0] : ''}
            onChange={(e) => handleChange('expirationDate', e.target.value ? `${e.target.value}T00:00:00Z` : undefined)}
          />
        </div>

        <Input
          label={t('pages.policies.exclusions.reason')}
          value={exclusion.reason}
          onChange={(e) => handleChange('reason', e.target.value)}
          placeholder={t('pages.policies.exclusions.reasonPlaceholder')}
          required
        />
      </div>
    </div>
  );
};

export default PolicyExclusionEditor;
