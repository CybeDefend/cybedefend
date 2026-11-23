// ============================================================================
// StepExclusions - Step 3: Define policy exclusions
// ============================================================================

import React from 'react';
import { useTranslation } from 'react-i18next';

import { motion, AnimatePresence } from 'framer-motion';

import { PolicyExclusion } from '@/server/interfaces/Policy';
import { cn } from '@/utils/function/utils';
import Button from '@/components/atoms/button/Button';
import { PolicyFormData } from '../CreatePolicyPage';
import PolicyExclusionEditor from '../../components/PolicyExclusionEditor';
import { Code, FolderOpen, Plus } from '@/components/atoms/icon/icons';
import { AS_NOTICE_BLOCK, AS_NOTICE_FRAME, AS_NOTICE_TITLE } from '@/components/atoms/appsec/recipes';
import { AS_WORD_TONE } from '@/components/atoms/appsec/styles';

interface StepExclusionsProps {
  formData: PolicyFormData;
  onChange: (data: PolicyFormData) => void;
  errors: string[];
}

const StepExclusions: React.FC<StepExclusionsProps> = ({
  formData,
  onChange,
  errors,
}) => {
  const { t } = useTranslation();

  // Add a new exclusion
  const handleAddExclusion = () => {
    const newExclusion: PolicyExclusion = {
      pattern: '',
      reason: '',
    };
    onChange({ ...formData, exclusions: [...formData.exclusions, newExclusion] });
  };

  // Update an exclusion
  const handleUpdateExclusion = (index: number, updatedExclusion: PolicyExclusion) => {
    const newExclusions = [...formData.exclusions];
    newExclusions[index] = updatedExclusion;
    onChange({ ...formData, exclusions: newExclusions });
  };

  // Remove an exclusion
  const handleRemoveExclusion = (index: number) => {
    onChange({ ...formData, exclusions: formData.exclusions.filter((_, i) => i !== index) });
  };

  // Add template exclusion
  const addTemplateExclusion = (template: 'test' | 'vendor' | 'generated') => {
    let newExclusion: PolicyExclusion;

    switch (template) {
      case 'test':
        newExclusion = {
          pattern: 'test/**',
          reason: 'Test files are not deployed to production',
        };
        break;
      case 'vendor':
        newExclusion = {
          pattern: '**/vendor/**',
          reason: 'Third-party code - tracked separately',
        };
        break;
      case 'generated':
        newExclusion = {
          pattern: '**/generated/**',
          reason: 'Auto-generated code',
        };
        break;
      default:
        return;
    }

    onChange({ ...formData, exclusions: [...formData.exclusions, newExclusion] });
  };

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
          <Code className="h-4 w-4 text-zinc-500 dark:text-zinc-400"  />
          {t('pages.policies.steps.exclusions')}
          <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
            ({t('common.optional')})
          </span>
        </h2>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
          {t('pages.policies.steps.exclusionsDescription')}
        </p>
      </div>

      {/* Info Card about Exclusions */}
      <div className={AS_NOTICE_FRAME}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 space-y-3">
            <h4 className={AS_NOTICE_TITLE}>
              {t('pages.policies.info.whatAreExclusions')}
            </h4>
            <p>
              {t('pages.policies.info.exclusionsExplanation')}
            </p>

            {/* Pattern examples */}
            <details className="mt-2">
              <summary className="text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
                {t('pages.policies.info.viewPatternExamples')}
              </summary>
              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 space-y-1 ml-4">
                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">test/**</code> {t('pages.policies.info.patternExamples.testFolder')}</p>
                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">**/node_modules/**</code> {t('pages.policies.info.patternExamples.nodeModules')}</p>
                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">src/legacy/*.js</code> {t('pages.policies.info.patternExamples.legacyJs')}</p>
                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">**/*.test.ts</code> {t('pages.policies.info.patternExamples.testFiles')}</p>
                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">**/fixtures/**</code> {t('pages.policies.info.patternExamples.fixtures')}</p>
              </div>
            </details>

            {/* Important note */}
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-as-line px-2.5 py-2 text-xs text-zinc-700 dark:text-zinc-200">
              <span>
                <strong className="font-medium text-zinc-900 dark:text-zinc-100">{t('common.important')}:</strong>{' '}
                {t('pages.policies.info.exclusionWarning')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="space-y-2">
          {errors.map((error, i) => (
            <div key={i} className={AS_NOTICE_BLOCK}>
              <span className={AS_WORD_TONE.bad}>{error}</span>
            </div>
          ))}
        </div>
      )}

      {/* Quick Templates */}
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
          {t('pages.policies.quickTemplates')}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => addTemplateExclusion('test')}
          >
            {t('pages.policies.templates.excludeTests')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addTemplateExclusion('vendor')}
          >
            {t('pages.policies.templates.excludeVendor')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addTemplateExclusion('generated')}
          >
            {t('pages.policies.templates.excludeGenerated')}
          </Button>
        </div>
      </div>

      {/* Exclusions List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('pages.policies.exclusions.title')} ({formData.exclusions.length}/30)
            <span className="ml-2 text-xs tabular-nums text-zinc-500 dark:text-zinc-400 font-normal">
              ({t('common.optional')})
            </span>
          </span>
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={handleAddExclusion}
            disabled={formData.exclusions.length >= 30}
          >
            <Plus className="h-4 w-4 mr-1"  />
            {t('pages.policies.exclusions.addExclusion')}
          </Button>
        </div>

        <AnimatePresence mode="popLayout">
          {formData.exclusions.map((exclusion, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <PolicyExclusionEditor
                exclusion={exclusion}
                index={index}
                onChange={(updated: PolicyExclusion) => handleUpdateExclusion(index, updated)}
                onRemove={() => handleRemoveExclusion(index)}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Empty State */}
        {formData.exclusions.length === 0 && (
          <div
            className={cn(
              'text-center py-10 rounded-xl border border-dashed',
              'border-zinc-200 dark:border-as-line'
            )}
          >
            <FolderOpen
              className="h-8 w-8 text-zinc-300 dark:text-zinc-600 mb-3"
             />
            <h3 className="text-[15px] font-medium text-zinc-900 dark:text-zinc-100 mb-1">
              {t('pages.policies.exclusions.noExclusions')}
            </h3>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-4 max-w-md mx-auto">
              {t('pages.policies.exclusions.noExclusionsDescription')}
            </p>
            <Button variant="outline" onClick={handleAddExclusion}>
              <Plus className="h-4 w-4 mr-2"  />
              {t('pages.policies.exclusions.addExclusion')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StepExclusions;
