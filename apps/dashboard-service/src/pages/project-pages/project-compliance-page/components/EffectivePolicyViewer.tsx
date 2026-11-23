// ============================================================================
// EffectivePolicyViewer - Display the effective (merged) policy
// ============================================================================

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { motion, AnimatePresence } from 'framer-motion';

import { EffectivePolicyResponse, PolicyRule, ViolationAction } from '@/server/interfaces/Policy';
import { cn } from '@/utils/function/utils';
import Card from '@/components/atoms/card';
import Button from '@/components/atoms/button/Button';
import { ChevronDown, ChevronRight, FileCode, Sync } from '@/components/atoms/icon/icons';
import { AS_DOT_WORD, AS_PANEL_TITLE, AS_TAG, AS_WORD_TONE } from '@/components/atoms/appsec/styles';

interface EffectivePolicyViewerProps {
  effectivePolicy: EffectivePolicyResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

/** The policy's scope in the interface language; a scope the API adds later is shown as sent. */
const SCOPE_LABEL_KEYS: Record<string, string> = {
  ORGANIZATION: 'pages.policies.scope.organization',
  TEAM: 'pages.policies.scope.team',
  PROJECT: 'pages.policies.scope.project',
};

const EffectivePolicyViewer: React.FC<EffectivePolicyViewerProps> = ({
  effectivePolicy,
  loading,
  error,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const [expandedPolicies, setExpandedPolicies] = useState<Set<string>>(new Set());
  const [showRules, setShowRules] = useState(true);
  const [showExclusions, setShowExclusions] = useState(true);

  const togglePolicy = (policyId: string) => {
    const newExpanded = new Set(expandedPolicies);
    if (newExpanded.has(policyId)) {
      newExpanded.delete(policyId);
    } else {
      newExpanded.add(policyId);
    }
    setExpandedPolicies(newExpanded);
  };

  if (loading) {
    return (
      <Card variant="default" padding="md">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-zinc-200 dark:bg-as-raised rounded w-1/3" />
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-zinc-200 dark:bg-as-raised rounded" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card variant="default" padding="lg" className="text-center">
        <p className="text-red-500">{error}</p>
        <Button variant="ghost" size="sm" onClick={onRefresh} className="mt-4">
          <Sync className="h-4 w-4 mr-2"  />
          {t('common.retry')}
        </Button>
      </Card>
    );
  }

  if (!effectivePolicy) {
    return (
      <Card variant="default" padding="lg" className="text-center">
        <div className="py-8">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 dark:bg-white/[0.06]">
            <FileCode className="h-5 w-5 text-zinc-400 dark:text-zinc-500"  />
          </div>
          <h3 className={cn(AS_PANEL_TITLE, 'mb-2')}>
            {t('pages.projectCompliance.noEffectivePolicy')}
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('pages.projectCompliance.noEffectivePolicyDescription')}
          </p>
        </div>
      </Card>
    );
  }

  const { effectiveConfig, appliedPolicies } = effectivePolicy;

  // Check if rule type is composite
  const isCompositeType = (type: string) => 
    type === 'composite_and' || type === 'composite_or';

  // Format rule type for display
  const formatRuleType = (type: string) => {
    const typeLabels: Record<string, string> = {
      'severity': t('pages.policies.rules.types.severity'),
      'cvss_score': t('pages.policies.rules.types.cvss_score'),
      'cwe_check': t('pages.policies.rules.types.cwe_check'),
      'owasp_category': t('pages.policies.rules.types.owasp_category'),
      'scanner_type': t('pages.policies.rules.types.scanner_type'),
      'vulnerability_age_days': t('pages.policies.rules.types.vulnerability_age_days'),
      'branch': t('pages.policies.rules.types.branch'),
      'composite_and': t('pages.policies.rules.types.composite_and'),
      'composite_or': t('pages.policies.rules.types.composite_or'),
    };
    return typeLabels[type] || type;
  };

  // Format operator for display
  const formatOperator = (op: string) => {
    const opLabels: Record<string, string> = {
      'equals': '=',
      'not_equals': '≠',
      'gt': '>',
      'gte': '≥',
      'lt': '<',
      'lte': '≤',
      'in': 'in',
      'not_in': 'not in',
    };
    return opLabels[op] || op;
  };

  const renderRule = (rule: PolicyRule, index: number) => {
    const isComposite = isCompositeType(rule.type);

    return (
      <div
        key={rule.name || index}
        className={cn(
          'p-3 rounded-lg border',
          'bg-zinc-50 dark:bg-white/[0.03]',
          'border-zinc-200 dark:border-as-line'
        )}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {rule.name || `Rule ${index + 1}`}
            </span>
            {isComposite && (
              <span className={cn(AS_TAG, 'font-mono')}>
                {rule.type === 'composite_and' ? 'AND' : 'OR'}
              </span>
            )}
          </div>
          {/* The action as a word in its colour (no dot): red blocks, amber warns. */}
          <span className={cn(AS_DOT_WORD, rule.action === ViolationAction.BLOCK ? AS_WORD_TONE.bad : AS_WORD_TONE.warning)}>
            {rule.action === ViolationAction.BLOCK
              ? t('pages.policies.rules.actions.block')
              : t('pages.policies.rules.actions.warn')}
          </span>
        </div>
        
        {/* Show criteria for composite rules, operator/value for simple rules */}
        {isComposite && rule.criteria && rule.criteria.length > 0 ? (
          <div className="space-y-2">
            {rule.criteria.map((criterion, i) => (
              <div
                key={criterion.id || i}
                className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 pl-2 border-l-2 border-purple-300 dark:border-purple-600"
              >
                <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-white/[0.06] rounded-md">
                  {formatRuleType(criterion.type)}
                </span>
                <span className="font-medium">{formatOperator(criterion.operator)}</span>
                <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-white/[0.06] rounded-md font-medium">
                  {Array.isArray(criterion.value) ? criterion.value.join(', ') : String(criterion.value)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-white/[0.06] rounded-md">
              {formatRuleType(rule.type)}
            </span>
            {rule.operator && (
              <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-white/[0.06] rounded-md">
                {formatOperator(rule.operator)}
              </span>
            )}
            {rule.value !== undefined && (
              <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-white/[0.06] rounded-md">
                {Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value)}
              </span>
            )}
          </div>
        )}
        
        {rule.description && (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {rule.description}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Applied Policies */}
      <Card variant="default" padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-as-line">
          <h3 className="text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
            {t('pages.projectCompliance.appliedPolicies')} ({appliedPolicies.length})
          </h3>
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <Sync className="h-4 w-4"  />
          </Button>
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-as-line">
          {appliedPolicies.map((policy) => (
            <div key={policy.id} className="p-4">
              <button
                onClick={() => togglePolicy(policy.id)}
                className="w-full flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3">
                  {expandedPolicies.has(policy.id) ? <ChevronDown
                    className="h-5 w-5 text-zinc-400" /> : <ChevronRight
                    className="h-5 w-5 text-zinc-400" />}
                  <div>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {policy.name}
                    </span>
                    {/* One phrase, ordinary punctuation (no hairline). */}
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {t('pages.policies.effective.scopePriority', {
                        scope: SCOPE_LABEL_KEYS[policy.scope] ? t(SCOPE_LABEL_KEYS[policy.scope]) : policy.scope,
                        priority: policy.priority,
                      })}
                    </p>
                  </div>
                </div>
                <span className={cn(AS_DOT_WORD, policy.isEnabled ? AS_WORD_TONE.good : AS_WORD_TONE.neutral)}>
                  {policy.isEnabled
                    ? t('pages.policies.status.enabled')
                    : t('pages.policies.status.disabled')}
                </span>
              </button>

              <AnimatePresence>
                {expandedPolicies.has(policy.id) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 pl-7 space-y-2">
                      {policy.description && (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          {policy.description}
                        </p>
                      )}
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {t('pages.policies.effective.ruleCount', { count: policy.config.rules?.length || 0 })},{' '}
                        {t('pages.policies.effective.exclusionCount', { count: policy.config.exclusions?.length || 0 })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </Card>

      {/* Effective Rules */}
      <Card variant="default" padding="none" className="overflow-hidden">
        <button
          onClick={() => setShowRules(!showRules)}
          className="w-full flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-as-line hover:bg-zinc-50 dark:hover:bg-white/[0.06]"
        >
          <h3 className="text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
            {t('pages.policies.rules.title')} ({effectiveConfig.rules?.length || 0})
          </h3>
          {showRules ? <ChevronDown
            className="h-5 w-5 text-zinc-400" /> : <ChevronRight
            className="h-5 w-5 text-zinc-400" />}
        </button>

        <AnimatePresence>
          {showRules && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <div className="p-4 space-y-3">
                {effectiveConfig.rules && effectiveConfig.rules.length > 0 ? (
                  effectiveConfig.rules.map((rule, index) => renderRule(rule, index))
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-4">
                    {t('pages.policies.rules.noRules')}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* Effective Exclusions */}
      <Card variant="default" padding="none" className="overflow-hidden">
        <button
          onClick={() => setShowExclusions(!showExclusions)}
          className="w-full flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-as-line hover:bg-zinc-50 dark:hover:bg-white/[0.06]"
        >
          <h3 className="text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
            {t('pages.policies.exclusions.title')} ({effectiveConfig.exclusions?.length || 0})
          </h3>
          {showExclusions ? <ChevronDown
            className="h-5 w-5 text-zinc-400" /> : <ChevronRight
            className="h-5 w-5 text-zinc-400" />}
        </button>

        <AnimatePresence>
          {showExclusions && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <div className="p-4 space-y-3">
                {effectiveConfig.exclusions && effectiveConfig.exclusions.length > 0 ? (
                  effectiveConfig.exclusions.map((exclusion, index) => (
                    <div
                      key={exclusion.pattern || index}
                      className={cn(
                        'p-3 rounded-lg border',
                        'bg-zinc-50 dark:bg-white/[0.03]',
                        'border-zinc-200 dark:border-as-line'
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <code className="text-sm text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-as-raised px-2 py-0.5 rounded">
                          {exclusion.pattern}
                        </code>
                        {exclusion.expirationDate && (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {t('pages.policies.effective.expires', { date: new Date(exclusion.expirationDate).toLocaleDateString() })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {exclusion.reason}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-4">
                    {t('pages.policies.exclusions.noExclusions')}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
};

export default EffectivePolicyViewer;
