// ============================================================================
// StepRules - Step 2: Define policy rules
// ============================================================================

import React from 'react';
import { useTranslation } from 'react-i18next';

import { motion, AnimatePresence } from 'framer-motion';

import {
    PolicyRule,
    RuleType,
    RuleOperator,
    ViolationAction,
} from '@/server/interfaces/Policy';
import { cn } from '@/utils/function/utils';
import Button from '@/components/atoms/button/Button';
import { PolicyFormData } from '../CreatePolicyPage';
import PolicyRuleEditor from '../../components/PolicyRuleEditor';
import { AlertTriangle, Ban, Plus, ShieldAlt } from '@/components/atoms/icon/icons';
import { AS_NOTICE_BLOCK, AS_NOTICE_FRAME, AS_NOTICE_TITLE } from '@/components/atoms/appsec/recipes';
import { AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import { EDITION } from '@/edition/edition';

// Licence management is the cloud's: no licence rule in
// the Community Edition.
const LICENSE_RULES = EDITION !== 'community';

interface StepRulesProps {
    formData: PolicyFormData;
    onChange: (data: PolicyFormData) => void;
    errors: string[];
}

const StepRules: React.FC<StepRulesProps> = ({
    formData,
    onChange,
    errors,
}) => {
    const { t } = useTranslation();

    // Add a new rule
    const handleAddRule = () => {
        const newRule: PolicyRule = {
            name: '',
            type: RuleType.SEVERITY,
            operator: RuleOperator.EQUALS,
            value: 'CRITICAL',
            action: ViolationAction.BLOCK,
            isEnabled: true,
        };
        onChange({ ...formData, rules: [...formData.rules, newRule] });
    };

    // Update a rule
    const handleUpdateRule = (index: number, updatedRule: PolicyRule) => {
        const newRules = [...formData.rules];
        newRules[index] = updatedRule;
        onChange({ ...formData, rules: newRules });
    };

    // Remove a rule
    const handleRemoveRule = (index: number) => {
        onChange({ ...formData, rules: formData.rules.filter((_, i) => i !== index) });
    };

    // Add a template rule
    const addTemplateRule = (template: 'critical' | 'high-cvss' | 'sast-critical') => {
        let newRule: PolicyRule;

        switch (template) {
            case 'critical':
                newRule = {
                    name: 'Block Critical Vulnerabilities',
                    type: RuleType.SEVERITY,
                    operator: RuleOperator.EQUALS,
                    value: 'CRITICAL',
                    action: ViolationAction.BLOCK,
                    isEnabled: true,
                    description: 'Critical vulnerabilities must be fixed before deployment',
                };
                break;
            case 'high-cvss':
                newRule = {
                    name: 'Block High CVSS Score',
                    type: RuleType.CVSS_SCORE,
                    operator: RuleOperator.GTE,
                    value: 9.0,
                    action: ViolationAction.BLOCK,
                    isEnabled: true,
                    description: 'CVSS score 9.0 or above is not acceptable',
                };
                break;
            case 'sast-critical':
                // Composite rule: scanner_type = sast AND severity = critical
                newRule = {
                    name: 'Block Critical SAST Findings',
                    type: RuleType.COMPOSITE_AND,
                    action: ViolationAction.BLOCK,
                    isEnabled: true,
                    description: 'Block critical vulnerabilities found by SAST scanner',
                    criteria: [
                        {
                            type: RuleType.SCANNER_TYPE,
                            operator: RuleOperator.EQUALS,
                            value: 'sast',
                        },
                        {
                            type: RuleType.SEVERITY,
                            operator: RuleOperator.EQUALS,
                            value: 'CRITICAL',
                        },
                    ],
                };
                break;
            default:
                return;
        }

        onChange({ ...formData, rules: [...formData.rules, newRule] });
    };

    // Add template for blocking old vulnerabilities
    const addOldVulnTemplate = () => {
        const newRule: PolicyRule = {
            name: 'Block Old Vulnerabilities',
            type: RuleType.VULNERABILITY_AGE_DAYS,
            operator: RuleOperator.GT,
            value: 30,
            action: ViolationAction.BLOCK,
            isEnabled: true,
            description: 'Vulnerabilities older than 30 days must be fixed',
        };
        onChange({ ...formData, rules: [...formData.rules, newRule] });
    };

    // Add template for blocking strong copyleft licenses
    const addBlockCopyleftTemplate = () => {
        const newRule: PolicyRule = {
            name: 'Block Strong Copyleft Licenses',
            type: RuleType.LICENSE_CHECK,
            operator: RuleOperator.IN,
            value: ['STRONG_COPYLEFT', 'UNKNOWN'],
            action: ViolationAction.BLOCK,
            isEnabled: true,
            description: 'Block packages with strong copyleft or unknown licenses',
        };
        onChange({ ...formData, rules: [...formData.rules, newRule] });
    };

    return (
        <div className="space-y-6">
            {/* Step Header */}
            <div>
                <h2 className="text-lg font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                    <ShieldAlt className="h-4 w-4 text-secondary dark:text-secondary-light"  />
                    {t('pages.policies.steps.rules')}
                </h2>
                <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
                    {t('pages.policies.steps.rulesDescription')}
                </p>
            </div>

            {/* Info Card about Rules */}
            <div className={AS_NOTICE_FRAME}>
                <div className="flex gap-2">
                    <div className="min-w-0 flex-1 space-y-3">
                        <h4 className={AS_NOTICE_TITLE}>
                            {t('pages.policies.info.howRulesWork')}
                        </h4>
                        <p>
                            {t('pages.policies.info.rulesExplanation')}
                        </p>

                        {/* Actions explanation */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                            <div className="flex items-start gap-2 rounded-lg border border-as-line p-2">
                                <Ban className="h-4 w-4 shrink-0 text-red-500 mt-0.5"  />
                                <div>
                                    <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                                        {t('pages.policies.rules.actions.block')}
                                    </span>
                                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                        {t('pages.policies.info.blockExplanation')}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start gap-2 rounded-lg border border-as-line p-2">
                                <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500 mt-0.5"  />
                                <div>
                                    <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                                        {t('pages.policies.rules.actions.warn')}
                                    </span>
                                    <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                        {t('pages.policies.info.warnExplanation')}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Rule types */}
                        <details className="mt-2">
                            <summary className="text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
                                {t('pages.policies.info.viewRuleTypes')}
                            </summary>
                            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 space-y-1 ml-4">
                                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">severity</code> {t('pages.policies.info.ruleTypeHints.severity')}</p>
                                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">cvss_score</code> {t('pages.policies.info.ruleTypeHints.cvss_score')}</p>
                                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">cwe_id</code> {t('pages.policies.info.ruleTypeHints.cwe_id')}</p>
                                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">owasp_category</code> {t('pages.policies.info.ruleTypeHints.owasp_category')}</p>
                                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">scanner_type</code> {t('pages.policies.info.ruleTypeHints.scanner_type')}</p>
                                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">vulnerability_age</code> {t('pages.policies.info.ruleTypeHints.vulnerability_age')}</p>
                                <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">is_new_vulnerability</code> {t('pages.policies.info.ruleTypeHints.is_new_vulnerability')}</p>
                                {LICENSE_RULES && (
                                    <p><code className="rounded bg-zinc-100 px-1 font-mono text-zinc-800 dark:bg-white/[0.06] dark:text-zinc-200">license_check</code> {t('pages.policies.info.ruleTypeHints.license_check')}</p>
                                )}
                            </div>
                        </details>
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
                        onClick={() => addTemplateRule('critical')}
                    >
                        {t('pages.policies.templates.blockCritical')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addTemplateRule('high-cvss')}
                    >
                        {t('pages.policies.templates.blockHighCvss')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addTemplateRule('sast-critical')}
                    >
                        {t('pages.policies.templates.blockSastCritical')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={addOldVulnTemplate}
                    >
                        {t('pages.policies.templates.blockOldVulns')}
                    </Button>
                    {LICENSE_RULES && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={addBlockCopyleftTemplate}
                        >
                            {t('pages.policies.templates.blockCopyleft')}
                        </Button>
                    )}
                </div>
            </div>

            {/* Rules List */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                        {t('pages.policies.rules.title')} ({formData.rules.length}/15)
                    </span>
                    <Button 
                        variant="secondary" 
                        size="sm" 
                        onClick={handleAddRule}
                        disabled={formData.rules.length >= 15}
                    >
                        <Plus className="h-4 w-4 mr-1"  />
                        {t('pages.policies.rules.addRule')}
                    </Button>
                </div>

                <AnimatePresence mode="popLayout">
                    {formData.rules.map((rule, index) => (
                        <motion.div
                            key={`rule-${index}`}
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.2 }}
                        >
                            <PolicyRuleEditor
                                rule={rule}
                                index={index}
                                onChange={(updatedRule: PolicyRule) => handleUpdateRule(index, updatedRule)}
                                onRemove={() => handleRemoveRule(index)}
                            />
                        </motion.div>
                    ))}
                </AnimatePresence>

                {/* Empty State */}
                {formData.rules.length === 0 && (
                    <div
                        className={cn(
                            'text-center py-10 rounded-xl border border-dashed',
                            'border-zinc-200 dark:border-as-line'
                        )}
                    >
                        <ShieldAlt
                            className="h-8 w-8 text-zinc-300 dark:text-zinc-600 mb-3"
                         />
                        <h3 className="text-[15px] font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                            {t('pages.policies.rules.noRules')}
                        </h3>
                        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-4">
                            {t('pages.policies.rules.noRulesDescription')}
                        </p>
                        <Button variant="secondary" onClick={handleAddRule}>
                            <Plus className="h-4 w-4 mr-2"  />
                            {t('pages.policies.rules.addFirstRule')}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StepRules;
