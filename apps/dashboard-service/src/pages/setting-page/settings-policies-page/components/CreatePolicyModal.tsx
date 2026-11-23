// ============================================================================
// CreatePolicyModal - Modal for creating a new policy
// ============================================================================

import React, { useState, useMemo } from 'react';
import { AS_NOTICE_BLOCK } from '@/components/atoms/appsec/recipes';
import { AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import * as yaml from 'js-yaml';

import { RootState } from '@/server/store';
import {
  CreatePolicyDto,
  PolicyScope,
  PolicyRule,
  PolicyExclusion,
  RuleType,
  RuleOperator,
  ViolationAction,
} from '@/server/interfaces/Policy';
import { validatePolicyConfig } from '@/server/services/policyService';

import Modal from '@/components/atoms/modal/Modal';
import Button from '@/components/atoms/button/Button';
import Input from '@/components/atoms/input/Input';
import Select from '@/components/atoms/select/Select';
import Toggle from '@/components/atoms/toggle/Toggle';
import { apiErrorKey } from '@/utils/function/apiErrorKey';

import PolicyRuleEditor from './PolicyRuleEditor';
import PolicyExclusionEditor from './PolicyExclusionEditor';

interface CreatePolicyModalProps {
  organizationId: string;
  onClose: () => void;
  onCreate: (data: CreatePolicyDto) => Promise<void>;
}

const CreatePolicyModal: React.FC<CreatePolicyModalProps> = ({
  organizationId,
  onClose,
  onCreate,
}) => {
  const { t } = useTranslation();
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<PolicyScope>(PolicyScope.ORGANIZATION);
  const [targetId, setTargetId] = useState(organizationId);
  const [priority, setPriority] = useState(50);
  const [isEnabled, setIsEnabled] = useState(true);
  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [exclusions, setExclusions] = useState<PolicyExclusion[]>([]);

  // UI State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Generate YAML content for validation
  const yamlContent = useMemo(() => {
    const config = {
      version: '1.0',
      name: name || 'Untitled Policy',
      description: description || undefined,
      scope,
      priority,
      enabled: isEnabled,
      rules: rules.map((rule) => ({
        name: rule.name,
        type: rule.type,
        action: rule.action,
        isEnabled: rule.isEnabled ?? true,
        description: rule.description || undefined,
        operator: rule.operator,
        value: rule.value,
      })),
      exclusions: exclusions.length > 0
        ? exclusions.map((exc) => ({
            pattern: exc.pattern,
            reason: exc.reason,
            expirationDate: exc.expirationDate || undefined,
          }))
        : undefined,
    };

    try {
      return yaml.dump(config, { indent: 2, lineWidth: -1, noRefs: true });
    } catch {
      return '# Error generating YAML';
    }
  }, [name, description, scope, priority, isEnabled, rules, exclusions]);

  const scopeOptions = [
    { value: PolicyScope.ORGANIZATION, label: t('pages.policies.scope.organization') },
    { value: PolicyScope.TEAM, label: t('pages.policies.scope.team') },
    { value: PolicyScope.PROJECT, label: t('pages.policies.scope.project') },
  ];

  // Update targetId when scope changes
  const handleScopeChange = (newScope: string) => {
    setScope(newScope as PolicyScope);
    if (newScope === PolicyScope.ORGANIZATION) {
      setTargetId(organizationId);
    } else {
      setTargetId(''); // User must select team or project
    }
  };

  // Add a new rule
  const handleAddRule = () => {
    const newRule: PolicyRule = {
      name: '',
      type: RuleType.SEVERITY,
      operator: RuleOperator.EQUALS,
      value: 'critical',
      action: ViolationAction.BLOCK,
    };
    setRules([...rules, newRule]);
  };

  // Update a rule
  const handleUpdateRule = (index: number, updatedRule: PolicyRule) => {
    const newRules = [...rules];
    newRules[index] = updatedRule;
    setRules(newRules);
  };

  // Remove a rule
  const handleRemoveRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  // Add a new exclusion
  const handleAddExclusion = () => {
    const newExclusion: PolicyExclusion = {
      pattern: '',
      reason: '',
    };
    setExclusions([...exclusions, newExclusion]);
  };

  // Update an exclusion
  const handleUpdateExclusion = (index: number, updatedExclusion: PolicyExclusion) => {
    const newExclusions = [...exclusions];
    newExclusions[index] = updatedExclusion;
    setExclusions(newExclusions);
  };

  // Remove an exclusion
  const handleRemoveExclusion = (index: number) => {
    setExclusions(exclusions.filter((_, i) => i !== index));
  };

  // Validate configuration
  const handleValidate = async () => {
    setIsValidating(true);
    setValidationErrors([]);
    setValidationWarnings([]);

    try {
      const response = await validatePolicyConfig(organizationId, yamlContent);
      
      if (!response.valid) {
        setValidationErrors(response.errors);
      }
      setValidationWarnings(response.warnings);
    } catch (err: any) {
      setValidationErrors([t(apiErrorKey(err))]);
    } finally {
      setIsValidating(false);
    }
  };

  // Form validation
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = t('errors.validation.required');
    }

    if (rules.length === 0) {
      newErrors.rules = t('pages.policies.validation.atLeastOneRule');
    }

    // Validate each rule has required fields
    rules.forEach((rule, index) => {
      if (!rule.name.trim()) {
        newErrors[`rule-${index}-name`] = t('errors.validation.required');
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Submit form
  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const data: CreatePolicyDto = {
        yamlContent: yamlContent,
      };

      await onCreate(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title={t('pages.policies.createPolicy')}
      size="xl"
      onClose={onClose}
      footerButtons={
        <>
          <Button
            variant="outline"
            onClick={handleValidate}
            loading={isValidating}
            disabled={isSubmitting}
          >
            {t('pages.policies.validateConfig')}
          </Button>
          <Button variant="white" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={handleSubmit} loading={isSubmitting}>
            {t('pages.policies.savePolicy')}
          </Button>
        </>
      }
    >
      <div className="space-y-6 max-h-[70vh] overflow-y-auto px-1">
        {/* Validation Messages */}
        {(validationErrors.length > 0 || validationWarnings.length > 0) && (
          <div className="space-y-2">
            {validationErrors.map((error, i) => (
              <div key={i} className={AS_NOTICE_BLOCK}>
                <span className={AS_WORD_TONE.bad}>{error}</span>
              </div>
            ))}
            {validationWarnings.map((warning, i) => (
              <div key={i} className={AS_NOTICE_BLOCK}>
                <span className={AS_WORD_TONE.warning}>{warning}</span>
              </div>
            ))}
          </div>
        )}

        {/* Basic Information */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50 border-b border-zinc-200 dark:border-as-line pb-2">
            {t('pages.policies.basicInfo')}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('pages.policies.policyName')}
              placeholder={t('pages.policies.policyNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              error={errors.name}
            />

            <div>
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                {t('pages.policies.scope.label')}
              </label>
              <Select
                options={scopeOptions}
                value={scope}
                onChange={handleScopeChange}
              />
            </div>
          </div>

          <Input
            label={t('pages.policies.policyDescription')}
            placeholder={t('pages.policies.policyDescriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            textarea
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('pages.policies.priority')}
              type="number"
              value={priority.toString()}
              onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
              min={1}
              max={100}
            />

            <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-as-line dark:bg-white/[0.03]">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t('pages.policies.enabled')}
              </span>
              <Toggle enabled={isEnabled} onChange={setIsEnabled} />
            </div>
          </div>
        </div>

        {/* Rules Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-as-line pb-2">
            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {t('pages.policies.rules.title')} ({rules.length})
            </h3>
            <Button variant="ghost" size="sm" onClick={handleAddRule}>
              {t('pages.policies.rules.addRule')}
            </Button>
          </div>

          {errors.rules && (
            <p className="text-[13px] text-red-600 dark:text-red-400">{errors.rules}</p>
          )}

          <div className="space-y-3">
            {rules.map((rule, index) => (
              <PolicyRuleEditor
                key={`rule-${index}`}
                rule={rule}
                index={index}
                onChange={(updatedRule: PolicyRule) => handleUpdateRule(index, updatedRule)}
                onRemove={() => handleRemoveRule(index)}
                error={errors[`rule-${index}-name`]}
              />
            ))}

            {rules.length === 0 && (
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 text-center py-4">
                {t('pages.policies.rules.noRules')}
              </p>
            )}
          </div>
        </div>

        {/* Exclusions Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-as-line pb-2">
            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {t('pages.policies.exclusions.title')} ({exclusions.length})
            </h3>
            <Button variant="ghost" size="sm" onClick={handleAddExclusion}>
              {t('pages.policies.exclusions.addExclusion')}
            </Button>
          </div>

          <div className="space-y-3">
            {exclusions.map((exclusion, index) => (
              <PolicyExclusionEditor
                key={index}
                exclusion={exclusion}
                index={index}
                onChange={(updated: PolicyExclusion) => handleUpdateExclusion(index, updated)}
                onRemove={() => handleRemoveExclusion(index)}
              />
            ))}

            {exclusions.length === 0 && (
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 text-center py-4">
                {t('pages.policies.exclusions.noExclusions')}
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CreatePolicyModal;
