// ============================================================================
// PolicyRuleEditor - Editor component for individual policy rules
// Supports simple rules and composite rules (composite_and, composite_or)
// ============================================================================

import React, { useMemo } from 'react';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';
import { useTranslation } from 'react-i18next';

import { motion, AnimatePresence } from 'framer-motion';

import {
  PolicyRule,
  RuleType,
  RuleOperator,
  ViolationAction,
  RuleCriterion,
} from '@/server/interfaces/Policy';
import { cn } from '@/utils/function/utils';
import Input from '@/components/atoms/input/Input';
import Select from '@/components/atoms/select/Select';
import GenericTagInput from '@/components/atoms/tag-input/GenericTagInput';
import licenseDescriptions from '@/utils/data/licenseDescriptions';
import { ChevronDown, ChevronUp, LayerGroup, Plus, Trash } from '@/components/atoms/icon/icons';

import { AS_FOCUS, AS_TOUCH, AS_TOUCH_SQUARE, AS_CHIP } from '@/components/atoms/appsec/styles';
import { EDITION } from '@/edition/edition';
// SPDX license options built from licenseDescriptions
const LICENSE_NAME_OPTIONS = Object.entries(licenseDescriptions).map(([spdxId, desc]) => ({
  value: spdxId,
  label: `${spdxId} (${desc.name})`,
}));

interface PolicyRuleEditorProps {
  rule: PolicyRule;
  index: number;
  onChange: (rule: PolicyRule) => void;
  onRemove: () => void;
  error?: string;
}

// Define valid operators per rule type
const OPERATORS_BY_TYPE: Record<string, RuleOperator[]> = {
  [RuleType.SEVERITY]: [
    RuleOperator.EQUALS,
    RuleOperator.NOT_EQUALS,
    RuleOperator.IN,
    RuleOperator.NOT_IN,
    RuleOperator.GTE,
    RuleOperator.LTE,
  ],
  [RuleType.CVSS_SCORE]: [
    RuleOperator.EQUALS,
    RuleOperator.NOT_EQUALS,
    RuleOperator.GT,
    RuleOperator.GTE,
    RuleOperator.LT,
    RuleOperator.LTE,
  ],
  [RuleType.CWE_CHECK]: [
    RuleOperator.EQUALS,
    RuleOperator.NOT_EQUALS,
    RuleOperator.IN,
    RuleOperator.NOT_IN,
  ],
  [RuleType.OWASP_CATEGORY]: [
    RuleOperator.EQUALS,
    RuleOperator.NOT_EQUALS,
    RuleOperator.IN,
    RuleOperator.NOT_IN,
  ],
  [RuleType.SCANNER_TYPE]: [
    RuleOperator.EQUALS,
    RuleOperator.NOT_EQUALS,
    RuleOperator.IN,
    RuleOperator.NOT_IN,
  ],
  [RuleType.VULNERABILITY_AGE_DAYS]: [
    RuleOperator.EQUALS,
    RuleOperator.NOT_EQUALS,
    RuleOperator.GT,
    RuleOperator.GTE,
    RuleOperator.LT,
    RuleOperator.LTE,
  ],
  [RuleType.BRANCH]: [
    RuleOperator.EQUALS,
    RuleOperator.NOT_EQUALS,
    RuleOperator.IN,
    RuleOperator.NOT_IN,
  ],
  [RuleType.LICENSE_CHECK]: [
    RuleOperator.EQUALS,
    RuleOperator.NOT_EQUALS,
    RuleOperator.IN,
    RuleOperator.NOT_IN,
  ],
  [RuleType.LICENSE_NAME_CHECK]: [
    RuleOperator.EQUALS,
    RuleOperator.NOT_EQUALS,
    RuleOperator.IN,
    RuleOperator.NOT_IN,
  ],
};

// Severity values
const SEVERITY_VALUES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

// Scanner types
const SCANNER_TYPE_VALUES = ['sast', 'sca', 'secret', 'container', 'iac', 'cicd'] as const;

// License types
const LICENSE_TYPE_VALUES = ['PERMISSIVE', 'WEAK_COPYLEFT', 'STRONG_COPYLEFT', 'UNKNOWN'] as const;

// Simple rule types (non-composite)
const SIMPLE_RULE_TYPES = [
  RuleType.SEVERITY,
  RuleType.CVSS_SCORE,
  RuleType.CWE_CHECK,
  RuleType.OWASP_CATEGORY,
  RuleType.SCANNER_TYPE,
  RuleType.VULNERABILITY_AGE_DAYS,
  RuleType.BRANCH,
  RuleType.LICENSE_CHECK,
  RuleType.LICENSE_NAME_CHECK,
] as const;

// Licence management is the cloud's, and a SARIF import
// carries no licence: the Community Edition offers no licence rule type.
const LICENSE_RULE_TYPES: readonly RuleType[] = [RuleType.LICENSE_CHECK, RuleType.LICENSE_NAME_CHECK];
const isOfferedRuleType = (type: RuleType): boolean =>
  EDITION !== 'community' || !LICENSE_RULE_TYPES.includes(type);

// Check if rule type is composite
const isCompositeType = (type: RuleType): boolean => {
  return type === RuleType.COMPOSITE_AND || type === RuleType.COMPOSITE_OR;
};

// ============================================================================
// Criterion Editor - For composite rule criteria
// ============================================================================

interface CriterionEditorProps {
  criterion: RuleCriterion;
  index: number;
  onChange: (criterion: RuleCriterion) => void;
  onRemove: () => void;
}

const CriterionEditor: React.FC<CriterionEditorProps> = ({
  criterion,
  index,
  onChange,
  onRemove,
}) => {
  const { t } = useTranslation();

  // Labels for criterion types with proper defaults
  const typeLabels: Record<string, string> = {
    [RuleType.SEVERITY]: t('pages.policies.rules.types.severity'),
    [RuleType.CVSS_SCORE]: t('pages.policies.rules.types.cvss_score'),
    [RuleType.CWE_CHECK]: t('pages.policies.rules.types.cwe_check'),
    [RuleType.OWASP_CATEGORY]: t('pages.policies.rules.types.owasp_category'),
    [RuleType.SCANNER_TYPE]: t('pages.policies.rules.types.scanner_type'),
    [RuleType.VULNERABILITY_AGE_DAYS]: t('pages.policies.rules.types.vulnerability_age_days'),
    [RuleType.BRANCH]: t('pages.policies.rules.types.branch'),
    [RuleType.LICENSE_CHECK]: t('pages.policies.rules.types.license_check'),
    [RuleType.LICENSE_NAME_CHECK]: t('pages.policies.rules.types.license_name_check'),
  };

  const typeOptions = SIMPLE_RULE_TYPES.filter(isOfferedRuleType).map((type) => ({
    value: type,
    label: typeLabels[type] || type,
  }));

  const operatorOptions = useMemo(() => {
    const validOperators = OPERATORS_BY_TYPE[criterion.type] || [];
    const allOperatorLabels: Record<RuleOperator, string> = {
      [RuleOperator.EQUALS]: t('pages.policies.rules.operators.equals'),
      [RuleOperator.NOT_EQUALS]: t('pages.policies.rules.operators.not_equals'),
      [RuleOperator.GT]: t('pages.policies.rules.operators.gt'),
      [RuleOperator.GTE]: t('pages.policies.rules.operators.gte'),
      [RuleOperator.LT]: t('pages.policies.rules.operators.lt'),
      [RuleOperator.LTE]: t('pages.policies.rules.operators.lte'),
      [RuleOperator.IN]: t('pages.policies.rules.operators.in'),
      [RuleOperator.NOT_IN]: t('pages.policies.rules.operators.not_in'),
    };

    return validOperators.map((op) => ({
      value: op,
      label: allOperatorLabels[op] || op,
    }));
  }, [criterion.type, t]);

  const handleChange = (field: keyof RuleCriterion, value: any) => {
    const updates: Partial<RuleCriterion> = { [field]: value };

    // When type changes, reset operator and value
    if (field === 'type') {
      const newType = value as RuleType;
      const validOperators = OPERATORS_BY_TYPE[newType] || [];
      updates.operator = validOperators[0] || RuleOperator.EQUALS;

      if (newType === RuleType.SEVERITY) {
        updates.value = 'CRITICAL';
      } else if (newType === RuleType.SCANNER_TYPE) {
        updates.value = 'sast';
      } else if (newType === RuleType.CVSS_SCORE) {
        updates.value = 7.0;
      } else if (newType === RuleType.VULNERABILITY_AGE_DAYS) {
        updates.value = 30;
      } else if (newType === RuleType.BRANCH) {
        updates.value = 'main';
      } else if (newType === RuleType.LICENSE_CHECK) {
        updates.value = 'STRONG_COPYLEFT';
      } else if (newType === RuleType.LICENSE_NAME_CHECK) {
        updates.value = 'MIT';
      } else {
        updates.value = '';
      }
    }

    // When operator changes to IN/NOT_IN, convert value to array
    if (field === 'operator') {
      const newOp = value as RuleOperator;
      if (newOp === RuleOperator.IN || newOp === RuleOperator.NOT_IN) {
        if (!Array.isArray(criterion.value)) {
          updates.value = criterion.value ? [String(criterion.value)] : [];
        }
      } else {
        if (Array.isArray(criterion.value)) {
          updates.value = criterion.value[0] || '';
        }
      }
    }

    onChange({ ...criterion, ...updates });
  };

  const isMultiValue = criterion.operator === RuleOperator.IN || criterion.operator === RuleOperator.NOT_IN;

  const renderValueInput = () => {
    // SEVERITY
    if (criterion.type === RuleType.SEVERITY) {
      if (isMultiValue) {
        const currentValues = Array.isArray(criterion.value) ? criterion.value : [];
        return (
          <div className="flex flex-wrap gap-1.5">
            {SEVERITY_VALUES.map((sev) => {
              const isSelected = currentValues.includes(sev);
              return (
                <button
                  key={sev}
                  type="button"
                  onClick={() => {
                    const newValues = isSelected
                      ? currentValues.filter((v) => v !== sev)
                      : [...currentValues, sev];
                    handleChange('value', newValues);
                  }}
                  className={cn(
                    'relative inline-flex h-6 items-center rounded-md px-2 text-xs font-medium transition-colors duration-[120ms] border', AS_FOCUS, AS_TOUCH,
                    isSelected
                      ? 'bg-secondary text-white border-secondary'
                      : 'bg-white dark:bg-as-raised text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-as-line-strong hover:border-zinc-300 dark:hover:border-white/[0.2]'
                  )}
                >
                  {sev}
                </button>
              );
            })}
          </div>
        );
      }
      return (
        <Select
          options={SEVERITY_VALUES.map((s) => ({ value: s, label: s }))}
          value={criterion.value as string}
          onChange={(v) => handleChange('value', v)}
        />
      );
    }

    // SCANNER_TYPE
    if (criterion.type === RuleType.SCANNER_TYPE) {
      if (isMultiValue) {
        const currentValues = Array.isArray(criterion.value) ? criterion.value : [];
        return (
          <div className="flex flex-wrap gap-1.5">
            {SCANNER_TYPE_VALUES.map((scanner) => {
              const isSelected = currentValues.includes(scanner);
              return (
                <button
                  key={scanner}
                  type="button"
                  onClick={() => {
                    const newValues = isSelected
                      ? currentValues.filter((v) => v !== scanner)
                      : [...currentValues, scanner];
                    handleChange('value', newValues);
                  }}
                  className={cn(
                    'relative inline-flex h-6 items-center rounded-md px-2 text-xs font-medium transition-colors duration-[120ms] border', AS_FOCUS, AS_TOUCH, 'uppercase',
                    isSelected
                      ? 'bg-secondary text-white border-secondary'
                      : 'bg-white dark:bg-as-raised text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-as-line-strong hover:border-zinc-300 dark:hover:border-white/[0.2]'
                  )}
                >
                  {scanner}
                </button>
              );
            })}
          </div>
        );
      }
      return (
        <Select
          options={SCANNER_TYPE_VALUES.map((s) => ({ value: s, label: s.toUpperCase() }))}
          value={criterion.value as string}
          onChange={(v) => handleChange('value', v)}
        />
      );
    }

    // CVSS_SCORE
    if (criterion.type === RuleType.CVSS_SCORE) {
      return (
        <Input
          type="number"
          value={String(criterion.value)}
          onChange={(e) => handleChange('value', parseFloat(e.target.value) || 0)}
          min={0}
          max={10}
        />
      );
    }

    // VULNERABILITY_AGE_DAYS
    if (criterion.type === RuleType.VULNERABILITY_AGE_DAYS) {
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={String(criterion.value)}
            onChange={(e) => handleChange('value', parseInt(e.target.value) || 0)}
            min={0}
          />
          <span className="text-sm text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
            {t('pages.policies.rules.days')}
          </span>
        </div>
      );
    }

    // CWE_CHECK with IN/NOT_IN
    if (criterion.type === RuleType.CWE_CHECK && isMultiValue) {
      const currentValues = Array.isArray(criterion.value) ? criterion.value : [];
      return (
        <GenericTagInput
          value={currentValues as string[]}
          onChange={(tags) => handleChange('value', tags)}
          placeholder={t('pages.policies.rules.cwePlaceholder')}
          validator={(v) => /^CWE-\d+$/i.test(v)}
          validationMessage={t('pages.policies.rules.cweInvalid')}
          formatValue={(v) => v.toUpperCase()}
        />
      );
    }

    // CWE_CHECK single
    if (criterion.type === RuleType.CWE_CHECK) {
      return (
        <Input
          value={String(criterion.value || '')}
          onChange={(e) => handleChange('value', e.target.value.toUpperCase())}
          placeholder="CWE-89"
        />
      );
    }

    // OWASP_CATEGORY with IN/NOT_IN
    if (criterion.type === RuleType.OWASP_CATEGORY && isMultiValue) {
      const currentValues = Array.isArray(criterion.value) ? criterion.value : [];
      return (
        <GenericTagInput
          value={currentValues as string[]}
          onChange={(tags) => handleChange('value', tags)}
          placeholder={t('pages.policies.rules.owaspPlaceholder')}
          validator={(v) => /^A\d{2}(:\d{4})?$/i.test(v)}
          validationMessage={t('pages.policies.rules.owaspInvalid')}
          formatValue={(v) => v.toUpperCase()}
        />
      );
    }

    // OWASP_CATEGORY single
    if (criterion.type === RuleType.OWASP_CATEGORY) {
      return (
        <Input
          value={String(criterion.value || '')}
          onChange={(e) => handleChange('value', e.target.value.toUpperCase())}
          placeholder="A01:2021"
        />
      );
    }

    // BRANCH with IN/NOT_IN
    if (criterion.type === RuleType.BRANCH && isMultiValue) {
      const currentValues = Array.isArray(criterion.value) ? criterion.value : [];
      return (
        <GenericTagInput
          value={currentValues as string[]}
          onChange={(tags) => handleChange('value', tags)}
          placeholder={t('pages.policies.rules.branchPlaceholder')}
        />
      );
    }

    // BRANCH single
    if (criterion.type === RuleType.BRANCH) {
      return (
        <Input
          value={String(criterion.value || '')}
          onChange={(e) => handleChange('value', e.target.value)}
          placeholder={t('pages.policies.rules.branchPlaceholder')}
        />
      );
    }

    // LICENSE_CHECK
    if (criterion.type === RuleType.LICENSE_CHECK) {
      if (isMultiValue) {
        const currentValues = Array.isArray(criterion.value) ? criterion.value : [];
        return (
          <div className="flex flex-wrap gap-1.5">
            {LICENSE_TYPE_VALUES.map((license) => {
              const isSelected = currentValues.includes(license);
              return (
                <button
                  key={license}
                  type="button"
                  onClick={() => {
                    const newValues = isSelected
                      ? currentValues.filter((v) => v !== license)
                      : [...currentValues, license];
                    handleChange('value', newValues);
                  }}
                  className={cn(
                    'relative inline-flex h-6 items-center rounded-md px-2 text-xs font-medium transition-colors duration-[120ms] border', AS_FOCUS, AS_TOUCH,
                    isSelected
                      ? 'bg-secondary text-white border-secondary'
                      : 'bg-white dark:bg-as-raised text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-as-line-strong hover:border-zinc-300 dark:hover:border-white/[0.2]'
                  )}
                >
                  {t(`pages.policies.rules.licenseTypes.${license}`, license)}
                </button>
              );
            })}
          </div>
        );
      }
      return (
        <Select
          options={LICENSE_TYPE_VALUES.map((l) => ({ value: l, label: t(`pages.policies.rules.licenseTypes.${l}`, l) }))}
          value={criterion.value as string}
          onChange={(v) => handleChange('value', v)}
        />
      );
    }

    // LICENSE_NAME_CHECK
    if (criterion.type === RuleType.LICENSE_NAME_CHECK) {
      if (isMultiValue) {
        const currentValues = Array.isArray(criterion.value) ? criterion.value as string[] : [];
        return (
          <Select
            multiple
            options={LICENSE_NAME_OPTIONS}
            value={currentValues}
            onChange={(vals) => handleChange('value', vals)}
            searchable
            searchPlaceholder={t('pages.policies.rules.licenseNamePlaceholder')}
            placeholder={t('pages.policies.rules.licenseNamePlaceholder')}
          />
        );
      }
      return (
        <Select
          options={LICENSE_NAME_OPTIONS}
          value={String(criterion.value || '')}
          onChange={(v) => handleChange('value', v)}
          searchable
          searchPlaceholder={t('pages.policies.rules.licenseNamePlaceholder')}
          placeholder={t('pages.policies.rules.licenseNamePlaceholder')}
        />
      );
    }

    // Default
    return (
      <Input
        value={String(criterion.value || '')}
        onChange={(e) => handleChange('value', e.target.value)}
        placeholder={t('pages.policies.rules.valuePlaceholder')}
      />
    );
  };

  return (
    <div className="p-3 rounded-xl bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-as-line">
      <div className="flex items-start gap-2">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mt-2">
          {index + 1}.
        </span>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
          <Select
            options={typeOptions}
            value={criterion.type}
            onChange={(v) => handleChange('type', v)}
          />
          <Select
            options={operatorOptions}
            value={criterion.operator}
            onChange={(v) => handleChange('operator', v)}
          />
          <div>{renderValueInput()}</div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className={cn("relative inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-red-600 transition-colors duration-[120ms] hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20", AS_FOCUS, AS_TOUCH_SQUARE)}
        >
          <Trash className="h-4 w-4"  />
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// Main PolicyRuleEditor Component
// ============================================================================

const PolicyRuleEditor: React.FC<PolicyRuleEditorProps> = ({
  rule,
  index,
  onChange,
  onRemove,
  error,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = React.useState(true);

  const isComposite = isCompositeType(rule.type);

  // All rule type options including composite - with proper translation keys
  const ruleTypeOptions = [
    { value: RuleType.SEVERITY, label: t('pages.policies.rules.types.severity') },
    { value: RuleType.CVSS_SCORE, label: t('pages.policies.rules.types.cvss_score') },
    { value: RuleType.CWE_CHECK, label: t('pages.policies.rules.types.cwe_check') },
    { value: RuleType.OWASP_CATEGORY, label: t('pages.policies.rules.types.owasp_category') },
    { value: RuleType.SCANNER_TYPE, label: t('pages.policies.rules.types.scanner_type') },
    { value: RuleType.VULNERABILITY_AGE_DAYS, label: t('pages.policies.rules.types.vulnerability_age_days') },
    { value: RuleType.BRANCH, label: t('pages.policies.rules.types.branch') },
    { value: RuleType.LICENSE_CHECK, label: t('pages.policies.rules.types.license_check') },
    { value: RuleType.LICENSE_NAME_CHECK, label: t('pages.policies.rules.types.license_name_check') },
    { value: RuleType.COMPOSITE_AND, label: t('pages.policies.rules.types.composite_and') },
    { value: RuleType.COMPOSITE_OR, label: t('pages.policies.rules.types.composite_or') },
  ].filter((option) => isOfferedRuleType(option.value));

  // Get valid operators based on current rule type (for non-composite)
  const operatorOptions = useMemo(() => {
    if (isComposite) return [];
    const validOperators = OPERATORS_BY_TYPE[rule.type] || [];
    const allOperatorLabels: Record<RuleOperator, string> = {
      [RuleOperator.EQUALS]: t('pages.policies.rules.operators.equals'),
      [RuleOperator.NOT_EQUALS]: t('pages.policies.rules.operators.not_equals'),
      [RuleOperator.GT]: t('pages.policies.rules.operators.gt'),
      [RuleOperator.GTE]: t('pages.policies.rules.operators.gte'),
      [RuleOperator.LT]: t('pages.policies.rules.operators.lt'),
      [RuleOperator.LTE]: t('pages.policies.rules.operators.lte'),
      [RuleOperator.IN]: t('pages.policies.rules.operators.in'),
      [RuleOperator.NOT_IN]: t('pages.policies.rules.operators.not_in'),
    };

    return validOperators.map((op) => ({
      value: op,
      label: allOperatorLabels[op] || op,
    }));
  }, [rule.type, t, isComposite]);

  const actionOptions = [
    { value: ViolationAction.BLOCK, label: t('pages.policies.rules.actions.block') },
    { value: ViolationAction.WARN, label: t('pages.policies.rules.actions.warn') },
  ];

  const handleChange = (field: keyof PolicyRule, value: any) => {
    const updates: Partial<PolicyRule> = { [field]: value };

    // When type changes
    if (field === 'type') {
      const newType = value as RuleType;
      const wasComposite = isCompositeType(rule.type);
      const willBeComposite = isCompositeType(newType);

      if (willBeComposite && !wasComposite) {
        // Switching to composite: add criteria, remove operator/value
        updates.criteria = [
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
        ];
        updates.operator = undefined;
        updates.value = undefined;
      } else if (!willBeComposite && wasComposite) {
        // Switching from composite: remove criteria, add operator/value
        updates.criteria = undefined;
        const validOperators = OPERATORS_BY_TYPE[newType] || [];
        updates.operator = validOperators[0] || RuleOperator.EQUALS;

        if (newType === RuleType.SEVERITY) {
          updates.value = 'CRITICAL';
        } else if (newType === RuleType.SCANNER_TYPE) {
          updates.value = 'sast';
        } else if (newType === RuleType.CVSS_SCORE) {
          updates.value = 7.0;
        } else if (newType === RuleType.VULNERABILITY_AGE_DAYS) {
          updates.value = 30;
        } else if (newType === RuleType.BRANCH) {
          updates.value = 'main';
        } else if (newType === RuleType.LICENSE_CHECK) {
          updates.value = 'STRONG_COPYLEFT';
        } else if (newType === RuleType.LICENSE_NAME_CHECK) {
          updates.value = 'MIT';
        } else {
          updates.value = '';
        }
      } else if (!willBeComposite) {
        // Switching between non-composite types
        const validOperators = OPERATORS_BY_TYPE[newType] || [];
        if (!validOperators.includes(rule.operator!)) {
          updates.operator = validOperators[0] || RuleOperator.EQUALS;
        }

        if (newType === RuleType.SEVERITY) {
          updates.value = 'CRITICAL';
        } else if (newType === RuleType.SCANNER_TYPE) {
          updates.value = 'sast';
        } else if (newType === RuleType.CVSS_SCORE) {
          updates.value = 7.0;
        } else if (newType === RuleType.VULNERABILITY_AGE_DAYS) {
          updates.value = 30;
        } else if (newType === RuleType.BRANCH) {
          updates.value = 'main';
        } else if (newType === RuleType.LICENSE_CHECK) {
          updates.value = 'STRONG_COPYLEFT';
        } else if (newType === RuleType.LICENSE_NAME_CHECK) {
          updates.value = 'MIT';
        } else {
          updates.value = '';
        }
      }
    }

    // When operator changes to IN/NOT_IN, convert value to array
    if (field === 'operator' && !isComposite) {
      const newOp = value as RuleOperator;
      if (newOp === RuleOperator.IN || newOp === RuleOperator.NOT_IN) {
        if (!Array.isArray(rule.value)) {
          updates.value = rule.value ? [String(rule.value)] : [];
        }
      } else {
        if (Array.isArray(rule.value)) {
          updates.value = rule.value[0] || '';
        }
      }
    }

    onChange({ ...rule, ...updates });
  };

  // Add criterion to composite rule
  const handleAddCriterion = () => {
    const newCriterion: RuleCriterion = {
      type: RuleType.SEVERITY,
      operator: RuleOperator.EQUALS,
      value: 'CRITICAL',
    };
    onChange({
      ...rule,
      criteria: [...(rule.criteria || []), newCriterion],
    });
  };

  // Update a criterion
  const handleUpdateCriterion = (criterionIndex: number, updated: RuleCriterion) => {
    const newCriteria = [...(rule.criteria || [])];
    newCriteria[criterionIndex] = updated;
    onChange({ ...rule, criteria: newCriteria });
  };

  // Remove a criterion
  const handleRemoveCriterion = (criterionIndex: number) => {
    onChange({
      ...rule,
      criteria: (rule.criteria || []).filter((_, i) => i !== criterionIndex),
    });
  };

  const isMultiValue = rule.operator === RuleOperator.IN || rule.operator === RuleOperator.NOT_IN;

  // Render value input for non-composite rules
  const renderValueInput = () => {
    if (isComposite) return null;

    // SEVERITY
    if (rule.type === RuleType.SEVERITY) {
      if (isMultiValue) {
        const currentValues = Array.isArray(rule.value) ? rule.value : [];
        return (
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t('pages.policies.rules.value')}
            </label>
            <div className="flex flex-wrap gap-2">
              {SEVERITY_VALUES.map((sev) => {
                const isSelected = currentValues.includes(sev);
                return (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => {
                      const newValues = isSelected
                        ? currentValues.filter((v) => v !== sev)
                        : [...currentValues, sev];
                      handleChange('value', newValues);
                    }}
                    className={cn(
                      'relative inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium transition-colors duration-[120ms] border', AS_FOCUS, AS_TOUCH, 'capitalize',
                      isSelected
                        ? 'bg-secondary text-white border-secondary'
                        : 'bg-white dark:bg-as-raised text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-as-line-strong hover:border-zinc-300 dark:hover:border-white/[0.2]'
                    )}
                  >
                    {sev}
                  </button>
                );
              })}
            </div>
          </div>
        );
      }
      return (
        <Select
          label={t('pages.policies.rules.value')}
          options={SEVERITY_VALUES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
          value={rule.value as string}
          onChange={(v) => handleChange('value', v)}
        />
      );
    }

    // SCANNER_TYPE
    if (rule.type === RuleType.SCANNER_TYPE) {
      if (isMultiValue) {
        const currentValues = Array.isArray(rule.value) ? rule.value : [];
        return (
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t('pages.policies.rules.value')}
            </label>
            <div className="flex flex-wrap gap-2">
              {SCANNER_TYPE_VALUES.map((scanner) => {
                const isSelected = currentValues.includes(scanner);
                return (
                  <button
                    key={scanner}
                    type="button"
                    onClick={() => {
                      const newValues = isSelected
                        ? currentValues.filter((v) => v !== scanner)
                        : [...currentValues, scanner];
                      handleChange('value', newValues);
                    }}
                    className={cn(
                      'relative inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium transition-colors duration-[120ms] border', AS_FOCUS, AS_TOUCH, 'uppercase',
                      isSelected
                        ? 'bg-secondary text-white border-secondary'
                        : 'bg-white dark:bg-as-raised text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-as-line-strong hover:border-zinc-300 dark:hover:border-white/[0.2]'
                    )}
                  >
                    {scanner}
                  </button>
                );
              })}
            </div>
          </div>
        );
      }
      return (
        <Select
          label={t('pages.policies.rules.value')}
          options={SCANNER_TYPE_VALUES.map((s) => ({ value: s, label: s.toUpperCase() }))}
          value={rule.value as string}
          onChange={(v) => handleChange('value', v)}
        />
      );
    }

    // CVSS_SCORE
    if (rule.type === RuleType.CVSS_SCORE) {
      return (
        <Input
          label={t('pages.policies.rules.value')}
          type="number"
          value={String(rule.value)}
          onChange={(e) => handleChange('value', parseFloat(e.target.value) || 0)}
          min={0}
          max={10}
        />
      );
    }

    // VULNERABILITY_AGE_DAYS
    if (rule.type === RuleType.VULNERABILITY_AGE_DAYS) {
      return (
        <div>
          <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
            {t('pages.policies.rules.value')}
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={String(rule.value)}
              onChange={(e) => handleChange('value', parseInt(e.target.value) || 0)}
              min={0}
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
              {t('pages.policies.rules.days')}
            </span>
          </div>
        </div>
      );
    }

    // CWE_CHECK with IN/NOT_IN
    if (rule.type === RuleType.CWE_CHECK && isMultiValue) {
      const currentValues = Array.isArray(rule.value) ? rule.value : [];
      return (
        <GenericTagInput
          label={t('pages.policies.rules.value')}
          value={currentValues as string[]}
          onChange={(tags) => handleChange('value', tags)}
          placeholder={t('pages.policies.rules.cwePlaceholder')}
          validator={(v) => /^CWE-\d+$/i.test(v)}
          validationMessage={t('pages.policies.rules.cweInvalid')}
          formatValue={(v) => v.toUpperCase()}
        />
      );
    }

    // CWE_CHECK single
    if (rule.type === RuleType.CWE_CHECK) {
      return (
        <Input
          label={t('pages.policies.rules.value')}
          value={String(rule.value || '')}
          onChange={(e) => handleChange('value', e.target.value.toUpperCase())}
          placeholder="CWE-89"
        />
      );
    }

    // OWASP_CATEGORY with IN/NOT_IN
    if (rule.type === RuleType.OWASP_CATEGORY && isMultiValue) {
      const currentValues = Array.isArray(rule.value) ? rule.value : [];
      return (
        <GenericTagInput
          label={t('pages.policies.rules.value')}
          value={currentValues as string[]}
          onChange={(tags) => handleChange('value', tags)}
          placeholder={t('pages.policies.rules.owaspPlaceholder')}
          validator={(v) => /^A\d{2}(:\d{4})?$/i.test(v)}
          validationMessage={t('pages.policies.rules.owaspInvalid')}
          formatValue={(v) => v.toUpperCase()}
        />
      );
    }

    // OWASP_CATEGORY single
    if (rule.type === RuleType.OWASP_CATEGORY) {
      return (
        <Input
          label={t('pages.policies.rules.value')}
          value={String(rule.value || '')}
          onChange={(e) => handleChange('value', e.target.value.toUpperCase())}
          placeholder="A01:2021"
        />
      );
    }

    // BRANCH with IN/NOT_IN
    if (rule.type === RuleType.BRANCH && isMultiValue) {
      const currentValues = Array.isArray(rule.value) ? rule.value : [];
      return (
        <GenericTagInput
          label={t('pages.policies.rules.value')}
          value={currentValues as string[]}
          onChange={(tags) => handleChange('value', tags)}
          placeholder={t('pages.policies.rules.branchPlaceholder')}
        />
      );
    }

    // BRANCH single
    if (rule.type === RuleType.BRANCH) {
      return (
        <Input
          label={t('pages.policies.rules.value')}
          value={String(rule.value || '')}
          onChange={(e) => handleChange('value', e.target.value)}
          placeholder={t('pages.policies.rules.branchPlaceholder')}
        />
      );
    }

    // LICENSE_CHECK
    if (rule.type === RuleType.LICENSE_CHECK) {
      if (isMultiValue) {
        const currentValues = Array.isArray(rule.value) ? rule.value : [];
        return (
          <div>
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t('pages.policies.rules.value')}
            </label>
            <div className="flex flex-wrap gap-2">
              {LICENSE_TYPE_VALUES.map((license) => {
                const isSelected = currentValues.includes(license);
                return (
                  <button
                    key={license}
                    type="button"
                    onClick={() => {
                      const newValues = isSelected
                        ? currentValues.filter((v) => v !== license)
                        : [...currentValues, license];
                      handleChange('value', newValues);
                    }}
                    className={cn(
                      'relative inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium transition-colors duration-[120ms] border', AS_FOCUS, AS_TOUCH,
                      isSelected
                        ? 'bg-secondary text-white border-secondary'
                        : 'bg-white dark:bg-as-raised text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-as-line-strong hover:border-zinc-300 dark:hover:border-white/[0.2]'
                    )}
                  >
                    {t(`pages.policies.rules.licenseTypes.${license}`, license)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      }
      return (
        <Select
          label={t('pages.policies.rules.value')}
          options={LICENSE_TYPE_VALUES.map((l) => ({ value: l, label: t(`pages.policies.rules.licenseTypes.${l}`, l) }))}
          value={rule.value as string}
          onChange={(v) => handleChange('value', v)}
        />
      );
    }

    // LICENSE_NAME_CHECK
    if (rule.type === RuleType.LICENSE_NAME_CHECK) {
      if (isMultiValue) {
        const currentValues = Array.isArray(rule.value) ? rule.value as string[] : [];
        return (
          <Select
            label={t('pages.policies.rules.value')}
            multiple
            options={LICENSE_NAME_OPTIONS}
            value={currentValues}
            onChange={(vals) => handleChange('value', vals)}
            searchable
            searchPlaceholder={t('pages.policies.rules.licenseNamePlaceholder')}
            placeholder={t('pages.policies.rules.licenseNamePlaceholder')}
          />
        );
      }
      return (
        <Select
          label={t('pages.policies.rules.value')}
          options={LICENSE_NAME_OPTIONS}
          value={String(rule.value || '')}
          onChange={(v) => handleChange('value', v)}
          searchable
          searchPlaceholder={t('pages.policies.rules.licenseNamePlaceholder')}
          placeholder={t('pages.policies.rules.licenseNamePlaceholder')}
        />
      );
    }

    // Default
    return (
      <Input
        label={t('pages.policies.rules.value')}
        value={Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value || '')}
        onChange={(e) => handleChange('value', e.target.value)}
        placeholder={t('pages.policies.rules.valuePlaceholder')}
      />
    );
  };

  return (
    <div
      className={cn(
        'border rounded-xl overflow-hidden transition-colors duration-[120ms]',
        'border-zinc-200 dark:border-as-line',
        'bg-zinc-50 dark:bg-white/[0.03]'
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between px-4 py-3 cursor-pointer',
          'hover:bg-zinc-100 dark:hover:bg-white/[0.06]'
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            #{index + 1}
          </span>
          {isComposite && (
            <LayerGroup
              className="h-4 w-4 text-zinc-500 dark:text-zinc-400"
              title={t('pages.policies.rules.compositeRule')}
             />
          )}
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {rule.name || t('pages.policies.rules.unnamedRule')}
          </span>
          {/* The action written in its own colour, no dot. */}
          <span
            className={cn(
              'whitespace-nowrap text-xs font-medium',
              rule.action === ViolationAction.BLOCK ? WORD_TONE.bad : WORD_TONE.warning
            )}
          >
            {rule.action === ViolationAction.BLOCK
              ? t('pages.policies.rules.actions.block')
              : t('pages.policies.rules.actions.warn')}
          </span>
          {isComposite && (
            <span className={cn(AS_CHIP, "border border-as-line text-zinc-600 dark:text-zinc-300")}>
              {rule.type === RuleType.COMPOSITE_AND ? 'AND' : 'OR'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className={cn(
              'relative inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-[120ms]', AS_FOCUS, AS_TOUCH_SQUARE,
              'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
            )}
          >
            <Trash className="h-4 w-4"  />
          </motion.button>
          {isExpanded ? <ChevronUp
            className="h-4 w-4 text-zinc-400" /> : <ChevronDown
            className="h-4 w-4 text-zinc-400" />}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-zinc-200 dark:border-as-line pt-4">
              {error && <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>}

              {/* Name and Action */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label={t('pages.policies.rules.ruleName')}
                  value={rule.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder={t('pages.policies.rules.ruleNamePlaceholder')}
                  required
                />

                <div>
                  <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    {t('pages.policies.rules.action')}
                  </label>
                  <div className="flex gap-2">
                    {actionOptions.map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          'relative flex h-8 items-center gap-2 px-3 rounded-lg cursor-pointer transition-colors duration-[120ms]', AS_TOUCH,
                          'border',
                          rule.action === option.value
                            ? option.value === ViolationAction.BLOCK
                              ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                              : 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
                            : 'border-zinc-200 dark:border-as-line hover:border-zinc-300 dark:hover:border-white/[0.2]'
                        )}
                      >
                        <input
                          type="radio"
                          name={`action-${index}`}
                          value={option.value}
                          checked={rule.action === option.value}
                          onChange={() => handleChange('action', option.value)}
                          className="sr-only"
                        />
                        <span
                          className={cn(
                            'text-[13px] font-medium',
                            rule.action === option.value
                              ? option.value === ViolationAction.BLOCK
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-yellow-700 dark:text-yellow-400'
                              : 'text-zinc-600 dark:text-zinc-400'
                          )}
                        >
                          {option.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Rule Type */}
              <div className={cn('grid gap-4', isComposite ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-3')}>
                <div>
                  <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    {t('pages.policies.rules.type')}
                  </label>
                  <Select
                    options={ruleTypeOptions}
                    value={rule.type}
                    onChange={(v) => handleChange('type', v)}
                  />
                </div>

                {/* Operator and Value for non-composite */}
                {!isComposite && (
                  <>
                    <div>
                      <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                        {t('pages.policies.rules.operator')}
                      </label>
                      <Select
                        options={operatorOptions}
                        value={rule.operator}
                        onChange={(v) => handleChange('operator', v)}
                      />
                    </div>
                    {renderValueInput()}
                  </>
                )}
              </div>

              {/* Composite Rule Criteria */}
              {isComposite && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
                      {t('pages.policies.rules.criteria')}
                      <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                        ({rule.type === RuleType.COMPOSITE_AND
                          ? t('pages.policies.rules.criteriaAndHint')
                          : t('pages.policies.rules.criteriaOrHint')})
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={handleAddCriterion}
                      className={cn("relative flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-secondary transition-colors duration-[120ms] hover:bg-secondary/10 dark:text-secondary-light", AS_FOCUS, AS_TOUCH)}
                    >
                      <Plus className="h-4 w-4"  />
                      {t('pages.policies.rules.addCriterion')}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {(rule.criteria || []).map((criterion, i) => (
                      <CriterionEditor
                        key={i}
                        criterion={criterion}
                        index={i}
                        onChange={(updated) => handleUpdateCriterion(i, updated)}
                        onRemove={() => handleRemoveCriterion(i)}
                      />
                    ))}

                    {(!rule.criteria || rule.criteria.length === 0) && (
                      <div className="text-center py-6 text-[13px] text-zinc-500 dark:text-zinc-400 border border-dashed border-zinc-200 dark:border-as-line rounded-xl">
                        {t('pages.policies.rules.noCriteria')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Optional Description */}
              <Input
                label={t('pages.policies.rules.description')}
                value={rule.description || ''}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder={t('pages.policies.rules.descriptionPlaceholder')}
                textarea
              />

              {/* isEnabled toggle */}
              <div className="flex items-center gap-3">
                <label className={cn("relative inline-flex items-center cursor-pointer", AS_TOUCH_SQUARE)}>
                  <input
                    type="checkbox"
                    checked={rule.isEnabled !== false}
                    onChange={(e) => handleChange('isEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-[18px] bg-zinc-300 rounded-full peer transition-colors duration-[160ms] ease-out peer-focus:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-secondary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-as-surface peer-checked:bg-secondary dark:bg-white/[0.16] dark:peer-checked:bg-secondary after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-3.5 after:w-3.5 after:shadow-[0_1px_2px_rgb(0_0_0/0.15)] after:transition-transform after:duration-[160ms] peer-checked:after:translate-x-3.5"></div>
                </label>
                <span className="text-[13px] text-zinc-700 dark:text-zinc-300">
                  {t('pages.policies.rules.ruleEnabled')}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PolicyRuleEditor;
