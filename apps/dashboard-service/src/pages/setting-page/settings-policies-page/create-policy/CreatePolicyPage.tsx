// ============================================================================
// CreatePolicyPage - Full page wizard for creating security policies
// ============================================================================

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthorization, useRebac } from 'react-rebac';
import { toast } from 'react-toastify';

import { motion, AnimatePresence } from 'framer-motion';
import * as yaml from 'js-yaml';

import { RootState } from '@/server/store';
import { usePolicies } from '@/server/hooks/usePolicies';
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
import { cn } from '@/utils/function/utils';
import { productHome } from '@/utils/product';

import { PageContainer } from '@/components/molecules/page-container';
import Button from '@/components/atoms/button/Button';
import Card from '@/components/atoms/card';

import StepIndicator from './components/StepIndicator';
import StepBasicInfo from './components/StepBasicInfo';
import StepRules from './components/StepRules';
import StepExclusions from './components/StepExclusions';
import StepReview from './components/StepReview';
import PolicyYamlPreview from './components/PolicyYamlPreview';
import { apiErrorKey } from '@/utils/function/apiErrorKey';
import { ArrowLeft, ArrowRight, Check, Code, Eye, EyeSlash, FileImport, InfoCircle, ShieldAlt } from '@/components/atoms/icon/icons';

// Step configuration
const STEPS = [
  { id: 1, key: 'basicInfo', icon: InfoCircle },
  { id: 2, key: 'rules', icon: ShieldAlt },
  { id: 3, key: 'exclusions', icon: Code },
  { id: 4, key: 'review', icon: Check },
];

export interface PolicyFormData {
  name: string;
  description: string;
  scope: PolicyScope;
  targetId: string; // For organization scope
  targetIds: string[]; // For team/project scope (multiple selection)
  priority: number;
  isEnabled: boolean;
  rules: PolicyRule[];
  exclusions: PolicyExclusion[];
}

const CreatePolicyPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );
  const user = useSelector((state: RootState) => state.user);
  const isProfileLoaded = user.isProfileLoaded;

  const { userEntities } = useRebac();
  const areUserEntitiesLoaded = userEntities && userEntities.length > 0;

  const isAuthorized = useAuthorization(
    selectedOrganization?.id || '',
    'organization',
    ['creator', 'administrator', 'manager']
  );

  const organizationId = selectedOrganization?.id || '';

  // The wizard shows no list: it loads none, and creating does not reload one.
  const { create } = usePolicies({ organizationId, autoFetch: false });

  // File input ref for YAML import
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [currentStep, setCurrentStep] = useState(1);
  const [showYamlPreview, setShowYamlPreview] = useState(false);
  const [yamlPreviewWasOpen, setYamlPreviewWasOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  // Cache for selected team/project names (persists across step navigation)
  const [selectedNamesCache, setSelectedNamesCache] = useState<Map<string, string>>(new Map());
  const [wrapperLoading, setWrapperLoading] = useState(true);

  // Form Data
  const [formData, setFormData] = useState<PolicyFormData>({
    name: '',
    description: '',
    scope: PolicyScope.ORGANIZATION,
    targetId: organizationId,
    targetIds: [],
    priority: 50,
    isEnabled: true,
    rules: [],
    exclusions: [],
  });

  // Step validation errors
  const [stepErrors, setStepErrors] = useState<Record<number, string[]>>({});

  // Authorization Check
  useEffect(() => {
    if (isProfileLoaded && areUserEntitiesLoaded) {
      if (!isAuthorized) {
        toast.error(t('errors.authorization.notAuthorized'));
        // A policies page belongs to AppSec even under the settings prefix: the refused account goes to the AppSec home, not to the root the landing rule decides.
        navigate(productHome('appsec'));
      }

      if (isAuthorized && selectedOrganization) {
        setWrapperLoading(false);
        setFormData((prev) => ({
          ...prev,
          targetId: selectedOrganization.id,
        }));
      }
    }
  }, [isAuthorized, selectedOrganization, navigate, isProfileLoaded, areUserEntitiesLoaded, t]);

  // Check if a rule type is composite
  const isCompositeType = (type: string) =>
    type === 'composite_and' || type === 'composite_or';

  // Generate YAML preview
  const yamlContent = useMemo(() => {
    const config: Record<string, unknown> = {
      version: '1.0',
      name: formData.name || 'Untitled Policy',
      description: formData.description || undefined,
      scope: formData.scope,
      priority: formData.priority,
      enabled: formData.isEnabled,
    };

    // Add target IDs for team/project scope
    if (formData.scope === PolicyScope.TEAM && formData.targetIds && formData.targetIds.length > 0) {
      config.teamIds = formData.targetIds;
    } else if (formData.scope === PolicyScope.PROJECT && formData.targetIds && formData.targetIds.length > 0) {
      config.projectIds = formData.targetIds;
    }

    config.rules = formData.rules.map((rule) => {
      const baseRule: Record<string, unknown> = {
        name: rule.name,
        type: rule.type,
        action: rule.action,
        isEnabled: rule.isEnabled ?? true,
      };

      if (rule.description) {
        baseRule.description = rule.description;
      }

      // Composite rules use criteria instead of operator/value
      if (isCompositeType(rule.type)) {
        if (rule.criteria && rule.criteria.length > 0) {
          baseRule.criteria = rule.criteria.map((c) => ({
            type: c.type,
            operator: c.operator,
            value: c.value,
          }));
        }
      } else {
        if (rule.operator) {
          baseRule.operator = rule.operator;
        }
        if (rule.value !== undefined) {
          baseRule.value = rule.value;
        }
      }

      return baseRule;
    });

    if (formData.exclusions.length > 0) {
      config.exclusions = formData.exclusions.map((exc) => ({
        pattern: exc.pattern,
        reason: exc.reason,
        expirationDate: exc.expirationDate || undefined,
      }));
    }

    try {
      return yaml.dump(config, { indent: 2, lineWidth: -1, noRefs: true });
    } catch {
      return '# Error generating YAML';
    }
  }, [formData]);

  // Validate current step
  const validateStep = (step: number): boolean => {
    const errors: string[] = [];

    switch (step) {
      case 1:
        if (!formData.name.trim()) {
          errors.push(t('pages.policies.validation.nameRequired'));
        }
        if (formData.scope !== PolicyScope.ORGANIZATION && (!formData.targetIds || formData.targetIds.length === 0)) {
          errors.push(t('pages.policies.validation.targetRequired'));
        }
        break;
      case 2:
        if (formData.rules.length === 0) {
          errors.push(t('pages.policies.validation.atLeastOneRule'));
        }
        if (formData.rules.length > 15) {
          errors.push(t('pages.policies.validation.maxRulesExceeded'));
        }
        formData.rules.forEach((rule, index) => {
          if (!rule.name.trim()) {
            errors.push(t('pages.policies.validation.ruleNameRequired', { index: index + 1 }));
          }
        });
        break;
      case 3:
        // Exclusions are optional, but if added, they need required fields
        if (formData.exclusions.length > 30) {
          errors.push(t('pages.policies.validation.maxExclusionsExceeded'));
        }
        formData.exclusions.forEach((exc, index) => {
          if (!exc.pattern.trim()) {
            errors.push(t('pages.policies.validation.patternRequired', { index: index + 1 }));
          }
          if (!exc.reason.trim()) {
            errors.push(t('pages.policies.validation.reasonRequired', { index: index + 1 }));
          }
        });
        break;
    }

    setStepErrors((prev) => ({ ...prev, [step]: errors }));
    return errors.length === 0;
  };

  // Handle step navigation
  const goToStep = (step: number) => {
    if (step < currentStep || validateStep(currentStep)) {
      // Save YAML preview state before going to step 4, then hide it
      if (step === 4) {
        setYamlPreviewWasOpen(showYamlPreview);
        setShowYamlPreview(false);
      }
      setCurrentStep(step);
    }
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      const nextStep = Math.min(currentStep + 1, STEPS.length);
      // Save YAML preview state before going to step 4, then hide it
      if (nextStep === 4) {
        setYamlPreviewWasOpen(showYamlPreview);
        setShowYamlPreview(false);
      }
      setCurrentStep(nextStep);
    }
  };

  const handlePrevious = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  // Validate configuration with backend
  const handleValidateConfig = async () => {
    setIsValidating(true);
    setValidationErrors([]);
    setValidationWarnings([]);

    try {
      const response = await validatePolicyConfig(
        organizationId,
        yamlContent
      );

      if (!response.valid) {
        setValidationErrors(response.errors);
      }
      setValidationWarnings(response.warnings);

      if (response.valid) {
        toast.success(t('pages.policies.messages.validationSuccess'));
      }
    } catch (err: any) {
      setValidationErrors([t(apiErrorKey(err))]);
    } finally {
      setIsValidating(false);
    }
  };

  // Submit policy
  const handleSubmit = async () => {
    // Validate all steps
    let allValid = true;
    for (let step = 1; step <= 3; step++) {
      if (!validateStep(step)) {
        allValid = false;
      }
    }

    if (!allValid) {
      toast.error(t('pages.policies.validation.fixErrors'));
      return;
    }

    setIsSubmitting(true);

    try {
      // Send yamlContent to the API
      const data: CreatePolicyDto = {
        yamlContent: yamlContent,
      };

      await create(data);
      toast.success(t('pages.policies.messages.createSuccess'));
      // Mark onboarding step
      try {
        const { completeOnboardingStep } = await import('@/server/services/userService');
        await completeOnboardingStep('policy_created');
      } catch { /* non-blocking */ }
      navigate('/organization/settings/policies');
    } catch (err: any) {
      toast.error(t(apiErrorKey(err, { fallback: 'errors.generic.operationFailed' })));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle cancel
  const handleCancel = () => {
    navigate('/organization/settings/policies');
  };

  // Handle YAML import
  const handleImportYaml = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = yaml.load(content) as Record<string, unknown>;

        if (!parsed || typeof parsed !== 'object') {
          toast.error(t('pages.policies.import.invalidFormat'));
          return;
        }

        // Map YAML to form data
        const importedRules: PolicyRule[] = Array.isArray(parsed.rules)
          ? parsed.rules.map((rule: Record<string, unknown>) => {
            // Handle value - can be string, number, or array of strings
            let value: string | number | string[] | undefined;
            if (rule.value !== undefined && rule.value !== null) {
              if (typeof rule.value === 'number') {
                value = rule.value;
              } else if (Array.isArray(rule.value)) {
                value = rule.value.map(String);
              } else {
                value = String(rule.value);
              }
            }

            return {
              name: String(rule.name || ''),
              type: (String(rule.type || 'severity').toLowerCase()) as RuleType,
              operator: (String(rule.operator || 'equals').toLowerCase()) as RuleOperator,
              value,
              action: (String(rule.action || 'WARN').toUpperCase()) as ViolationAction,
              description: rule.description ? String(rule.description) : undefined,
              isEnabled: rule.isEnabled !== false,
              criteria: Array.isArray(rule.criteria) ? rule.criteria : undefined,
            };
          })
          : [];

        const importedExclusions: PolicyExclusion[] = Array.isArray(parsed.exclusions)
          ? parsed.exclusions.map((exc: Record<string, unknown>) => ({
            pattern: String(exc.pattern || ''),
            reason: String(exc.reason || ''),
            expirationDate: exc.expirationDate ? String(exc.expirationDate) : undefined,
          }))
          : [];

        // Determine scope
        let scope = PolicyScope.ORGANIZATION;
        let targetIds: string[] = [];
        if (parsed.scope) {
          const scopeValue = String(parsed.scope).toUpperCase();
          if (scopeValue === 'TEAM') {
            scope = PolicyScope.TEAM;
            if (Array.isArray(parsed.teamIds)) {
              targetIds = parsed.teamIds.map(String);
            }
          } else if (scopeValue === 'PROJECT') {
            scope = PolicyScope.PROJECT;
            if (Array.isArray(parsed.projectIds)) {
              targetIds = parsed.projectIds.map(String);
            }
          }
        }

        setFormData({
          name: String(parsed.name || ''),
          description: String(parsed.description || ''),
          scope,
          targetId: scope === PolicyScope.ORGANIZATION ? organizationId : (targetIds[0] || ''),
          targetIds,
          priority: typeof parsed.priority === 'number' ? parsed.priority : 50,
          isEnabled: parsed.enabled !== false,
          rules: importedRules,
          exclusions: importedExclusions,
        });

        // Reset to step 1 to review imported data
        setCurrentStep(1);
        setStepErrors({});
        toast.success(t('pages.policies.import.success'));
      } catch (err) {
        console.error('YAML parse error:', err);
        toast.error(t('pages.policies.import.parseError'));
      }
    };

    reader.onerror = () => {
      toast.error(t('pages.policies.import.readError'));
    };

    reader.readAsText(file);
    // Reset input so the same file can be selected again
    event.target.value = '';
  };

  if (wrapperLoading) {
    return (
      <PageContainer background="default" padding="md">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-secondary" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer background="default" padding="md">
      <div className="mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={handleCancel}
            className="relative -ml-2 mb-4 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-zinc-500 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100 max-md:after:absolute max-md:after:inset-x-0 max-md:after:top-1/2 max-md:after:h-11 max-md:after:min-h-full max-md:after:-translate-y-1/2 max-md:after:content-['']"
          >
            <ArrowLeft className="h-4 w-4"  />
            {t('pages.policies.backToPolicies')}
          </button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-zinc-900 dark:text-zinc-50">
                {t('pages.policies.createPolicy')}
              </h1>
              <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
                {t('pages.policies.createDescription')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Import YAML Button */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".yaml,.yml"
                onChange={handleImportYaml}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="hidden sm:flex"
              >
                <FileImport className="h-4 w-4 mr-2"  />
                {t('pages.policies.importYaml')}
              </Button>

              {/* Preview YAML Button */}
              {currentStep !== 4 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowYamlPreview(!showYamlPreview)}
                  className="hidden md:flex"
                >
                  {showYamlPreview ? <EyeSlash
                    className="h-4 w-4 mr-2" /> : <Eye
                    className="h-4 w-4 mr-2" />}
                  {showYamlPreview
                    ? t('pages.policies.hideYaml')
                    : t('pages.policies.showYaml')}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Step Indicator */}
        <StepIndicator
          steps={STEPS.map((s) => ({
            ...s,
            label: t(`pages.policies.steps.${s.key}`, s.key),
          }))}
          currentStep={currentStep}
          onStepClick={goToStep}
          stepErrors={stepErrors}
        />

        {/* Main Content */}
        <div className="mt-8 flex gap-6 overflow-hidden">
          {/* Form Section - Full width when YAML hidden, 2/3 when shown */}
          <motion.div
            layout
            className="flex-1 min-w-0"
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            <Card variant="default" padding="lg">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  {currentStep === 1 && (
                    <StepBasicInfo
                      formData={formData}
                      onChange={setFormData}
                      errors={stepErrors[1] || []}
                      organizationId={organizationId}
                      selectedNamesCache={selectedNamesCache}
                      onUpdateNamesCache={setSelectedNamesCache}
                    />
                  )}
                  {currentStep === 2 && (
                    <StepRules
                      formData={formData}
                      onChange={setFormData}
                      errors={stepErrors[2] || []}
                    />
                  )}
                  {currentStep === 3 && (
                    <StepExclusions
                      formData={formData}
                      onChange={setFormData}
                      errors={stepErrors[3] || []}
                    />
                  )}
                  {currentStep === 4 && (
                    <StepReview
                      formData={formData}
                      validationErrors={validationErrors}
                      validationWarnings={validationWarnings}
                      isValidating={isValidating}
                      onValidate={handleValidateConfig}
                      yamlContent={yamlContent}
                      defaultShowYaml={yamlPreviewWasOpen}
                    />
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Navigation Buttons */}
              <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-as-line flex items-center justify-between">
                <Button
                  variant="ghost"
                  onClick={handlePrevious}
                  disabled={currentStep === 1 || isSubmitting}
                >
                  <ArrowLeft className="h-4 w-4 mr-2"  />
                  {t('common.previous')}
                </Button>

                <div className="flex items-center gap-3">
                  <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
                    {t('common.cancel')}
                  </Button>

                  {currentStep < STEPS.length ? (
                    <Button variant="secondary" onClick={handleNext}>
                      {t('common.next')}
                      <ArrowRight className="h-4 w-4 ml-2"  />
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={handleSubmit}
                      loading={isSubmitting}
                      disabled={isSubmitting}
                    >
                      <Check className="h-4 w-4 mr-2"  />
                      {t('pages.policies.createPolicy')}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>

          {/* YAML Preview Panel */}
          <AnimatePresence>
            {showYamlPreview && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 320 }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="w-[320px] max-w-[320px] flex-shrink-0 hidden lg:block overflow-hidden"
              >
                <PolicyYamlPreview yamlContent={yamlContent} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PageContainer>
  );
};

export default CreatePolicyPage;
