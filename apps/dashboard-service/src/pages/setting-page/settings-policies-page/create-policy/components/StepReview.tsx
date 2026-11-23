// ============================================================================
// StepReview - Step 4: Review and validate policy before creation
// ============================================================================

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';

import { PolicyScope, ViolationAction } from '@/server/interfaces/Policy';
import { cn } from '@/utils/function/utils';
import Button from '@/components/atoms/button/Button';
import { PolicyFormData } from '../CreatePolicyPage';
import { Check, CheckCircle, Clipboard, ClipboardCheck, Code, Download, InfoCircle, ShieldAlt } from '@/components/atoms/icon/icons';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';
import { AS_NOTICE_BLOCK, AS_NOTICE_FRAME, AS_NOTICE_TITLE, AS_STATUS_WORD, AS_COUNT, AS_COUNT_NUMBER, AS_COUNT_KIND } from '@/components/atoms/appsec/recipes';
import { copyText } from '@/utils/copyText';

interface StepReviewProps {
  formData: PolicyFormData;
  validationErrors: string[];
  validationWarnings: string[];
  isValidating: boolean;
  onValidate: () => Promise<void>;
  yamlContent: string;
  defaultShowYaml?: boolean;
}

const StepReview: React.FC<StepReviewProps> = ({
  formData,
  validationErrors,
  validationWarnings,
  isValidating,
  onValidate,
  yamlContent,
  defaultShowYaml = false,
}) => {
  const { t } = useTranslation();
  const [showYaml, setShowYaml] = useState(defaultShowYaml);
  const [copied, setCopied] = useState(false);

  const handleCopyYaml = async () => {
    if (await copyText(yamlContent)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadYaml = () => {
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${formData.name || 'policy'}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const scopeLabels: Record<PolicyScope, string> = {
    [PolicyScope.ORGANIZATION]: t('pages.policies.scope.organization'),
    [PolicyScope.TEAM]: t('pages.policies.scope.team'),
    [PolicyScope.PROJECT]: t('pages.policies.scope.project'),
  };

  const blockRulesCount = formData.rules.filter((r) => r.action === ViolationAction.BLOCK).length;
  const warnRulesCount = formData.rules.filter((r) => r.action === ViolationAction.WARN).length;

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
          <Check className="h-4 w-4 text-secondary dark:text-secondary-light"  />
          {t('pages.policies.steps.review')}
        </h2>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
          {t('pages.policies.steps.reviewDescription')}
        </p>
      </div>

      {/* Validation Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('pages.policies.validation.title')}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onValidate}
            loading={isValidating}
          >
            <CheckCircle className="h-4 w-4 mr-2"  />
            {t('pages.policies.validateConfig')}
          </Button>
        </div>

        {/* Validation Results */}
        {validationErrors.length > 0 && (
          <div className="space-y-2">
            {validationErrors.map((error, i) => (
              <div key={i} className={AS_NOTICE_BLOCK}>
                {/* An error in red, a warning in amber: the sentence carries the status (no dot). */}
                <span className={WORD_TONE.bad}>{error}</span>
              </div>
            ))}
          </div>
        )}

        {validationWarnings.length > 0 && (
          <div className="space-y-2">
            {validationWarnings.map((warning, i) => (
              <div key={i} className={AS_NOTICE_BLOCK}>
                <span className={WORD_TONE.warning}>{warning}</span>
              </div>
            ))}
          </div>
        )}

        {validationErrors.length === 0 && validationWarnings.length === 0 && (
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
            {t('pages.policies.validation.clickToValidate')}
          </p>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Basic Info Card */}
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-as-line">
          <div className="flex items-center gap-2 mb-3">
            <InfoCircle className="h-4 w-4 text-zinc-500 dark:text-zinc-400"  />
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {t('pages.policies.basicInfo')}
            </span>
          </div>
          <div className="space-y-2 text-[13px]">
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">
                {t('pages.policies.policyName')}:
              </span>
              <span className="ml-2 text-zinc-900 dark:text-zinc-100 font-medium">
                {formData.name || t('pages.policies.unavailable')}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">
                {t('pages.policies.scope.label')}:
              </span>
              <span className="ml-2 text-zinc-900 dark:text-zinc-100">
                {scopeLabels[formData.scope]}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">
                {t('pages.policies.priority')}:
              </span>
              <span className="ml-2 tabular-nums text-zinc-900 dark:text-zinc-100">{formData.priority}</span>
            </div>
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">
                {t('pages.policies.statusLabel')}:
              </span>
              <span className={cn('ml-2', AS_STATUS_WORD, formData.isEnabled && WORD_TONE.good)}>
                {formData.isEnabled
                  ? t('pages.policies.enabled')
                  : t('pages.policies.disabled')}
              </span>
            </div>
          </div>
        </div>

        {/* Rules Card */}
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-as-line">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlt className="h-4 w-4 text-zinc-500 dark:text-zinc-400"  />
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {t('pages.policies.rules.title')} ({formData.rules.length})
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={AS_COUNT}>
                <span className={AS_COUNT_NUMBER}>{blockRulesCount}</span>
                <span className={WORD_TONE.bad}>{t('pages.policies.rules.actions.block')}</span>
              </span>
              <span className={AS_COUNT}>
                <span className={AS_COUNT_NUMBER}>{warnRulesCount}</span>
                <span className={WORD_TONE.warning}>{t('pages.policies.rules.actions.warn')}</span>
              </span>
            </div>
            {formData.rules.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                {formData.rules.slice(0, 3).map((rule, i) => (
                  <li key={i} className="truncate">
                    {rule.name || `Rule #${i + 1}`}
                  </li>
                ))}
                {formData.rules.length > 3 && (
                  <li className="text-zinc-500 dark:text-zinc-400">
                    +{formData.rules.length - 3} {t('common.more')}
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

        {/* Exclusions Card */}
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-as-line">
          <div className="flex items-center gap-2 mb-3">
            <Code className="h-4 w-4 text-zinc-500 dark:text-zinc-400"  />
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {t('pages.policies.exclusions.title')} ({formData.exclusions.length})
            </span>
          </div>
          {formData.exclusions.length === 0 ? (
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
              {t('pages.policies.exclusions.none')}
            </p>
          ) : (
            <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {formData.exclusions.slice(0, 3).map((exc, i) => (
                <li key={i} className="truncate">
                  <code className="bg-zinc-100 dark:bg-white/[0.06] px-1 rounded">{exc.pattern}</code>
                </li>
              ))}
              {formData.exclusions.length > 3 && (
                <li className="text-zinc-500 dark:text-zinc-400">
                  +{formData.exclusions.length - 3} {t('common.more')}
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* YAML Preview Toggle */}
      <div className="space-y-3">
        <button
          onClick={() => setShowYaml(!showYaml)}
          className="flex items-center gap-2 text-[13px] font-medium text-secondary dark:text-secondary-light hover:underline"
        >
          <Code className="h-4 w-4"  />
          {showYaml
            ? t('pages.policies.hideYamlPreview')
            : t('pages.policies.showYamlPreview')}
        </button>

        {showYaml && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="relative"
          >
            <div className="absolute top-2 right-2 z-10 flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-7 px-0 text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 dark:hover:bg-white/[0.08]"
                onClick={handleDownloadYaml}
              >
                <Download
                  className="h-4 w-4"
                 />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-7 px-0 text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 dark:hover:bg-white/[0.08]"
                onClick={handleCopyYaml}
              >
                {copied ? <ClipboardCheck
                  className={cn('h-4 w-4', copied && 'text-green-500')} /> : <Clipboard
                  className={cn('h-4 w-4', copied && 'text-green-500')} />}
              </Button>
            </div>
            <pre
              className={cn(
                'p-4 rounded-xl overflow-x-auto text-xs font-mono',
                'bg-zinc-900 text-zinc-100',
                'max-h-80 overflow-y-auto'
              )}
            >
              {yamlContent}
            </pre>
          </motion.div>
        )}
      </div>

      {/* Final Note */}
      <div className={AS_NOTICE_FRAME}>
        <div className="flex gap-2">
          <div>
            <h4 className={cn(AS_NOTICE_TITLE, WORD_TONE.good)}>
              {t('pages.policies.readyToCreate')}
            </h4>
            <p className="mt-1">
              {t('pages.policies.createHint')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StepReview;
