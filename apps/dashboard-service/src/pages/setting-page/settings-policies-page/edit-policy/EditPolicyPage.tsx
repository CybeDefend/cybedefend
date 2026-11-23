// ============================================================================
// EditPolicyPage - Full page wizard for editing security policies
// ============================================================================

import React, { useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthorization, useRebac } from 'react-rebac';
import { toast } from 'react-toastify';

import { motion, AnimatePresence } from 'framer-motion';
import * as yaml from 'js-yaml';

import { RootState } from '@/server/store';
import { usePolicies } from '@/server/hooks/usePolicies';
import {
  UpdatePolicyDto,
  PolicyScope,
  PolicyRule,
  PolicyExclusion,
  RuleType,
  RuleOperator,
  ViolationAction,
  Policy,
} from '@/server/interfaces/Policy';
import { validatePolicyConfig, fetchPolicy } from '@/server/services/policyService';
import { cn } from '@/utils/function/utils';
import { productHome } from '@/utils/product';

import { PageContainer } from '@/components/molecules/page-container';
import Button from '@/components/atoms/button/Button';
import Card from '@/components/atoms/card';

import StepIndicator from '../create-policy/components/StepIndicator';
import StepBasicInfo from '../create-policy/components/StepBasicInfo';
import StepRules from '../create-policy/components/StepRules';
import StepExclusions from '../create-policy/components/StepExclusions';
import StepReview from '../create-policy/components/StepReview';
import PolicyYamlPreview from '../create-policy/components/PolicyYamlPreview';
import { PolicyFormData } from '../create-policy/CreatePolicyPage';
import { apiErrorKey } from '@/utils/function/apiErrorKey';
import { ArrowLeft, ArrowRight, Check, Code, Eye, EyeSlash, InfoCircle, Save, ShieldAlt } from '@/components/atoms/icon/icons';

// Step configuration
const STEPS = [
  { id: 1, key: 'basicInfo', icon: InfoCircle },
  { id: 2, key: 'rules', icon: ShieldAlt },
  { id: 3, key: 'exclusions', icon: Code },
  { id: 4, key: 'review', icon: Check },
];

const EditPolicyPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { policyId } = useParams<{ policyId: string }>();

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

  const { update } = usePolicies({ organizationId, autoFetch: false });

  // State
  const [currentStep, setCurrentStep] = useState(1);
  const [showYamlPreview, setShowYamlPreview] = useState(false);
  const [yamlPreviewWasOpen, setYamlPreviewWasOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [selectedNamesCache, setSelectedNamesCache] = useState<Map<string, string>>(new Map());
  const [wrapperLoading, setWrapperLoading] = useState(true);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [originalPolicy, setOriginalPolicy] = useState<Policy | null>(null);

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

  // Load policy data
  useEffect(() => {
    const loadPolicy = async () => {
      if (!organizationId || !policyId) return;

      try {
        setPolicyLoading(true);
        const policy = await fetchPolicy(organizationId, policyId);
        setOriginalPolicy(policy);

        // Convert policy to form data
        // Use teamIds/projectIds arrays from API response
        let targetIds: string[] = [];
        if (policy.scope === PolicyScope.TEAM && policy.teamIds && policy.teamIds.length > 0) {
          targetIds = [...policy.teamIds];
        } else if (policy.scope === PolicyScope.PROJECT && policy.projectIds && policy.projectIds.length > 0) {
          targetIds = [...policy.projectIds];
        }

        setFormData({
          name: policy.name,
          description: policy.description || '',
          scope: policy.scope,
          targetId: targetIds[0] || organizationId,
          targetIds,
          priority: policy.priority,
          isEnabled: policy.isEnabled,
          rules: policy.config.rules || [],
          exclusions: policy.config.exclusions || [],
        });
      } catch (err: any) {
        toast.error(t('errors.generic.loadFailed'));
        navigate('/organization/settings/policies');
      } finally {
        setPolicyLoading(false);
      }
    };

    loadPolicy();
  }, [organizationId, policyId, navigate, t]);

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

  // Submit policy update
  const handleSubmit = async () => {
    if (!policyId) return;

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
      const data: UpdatePolicyDto = {
        yamlContent: yamlContent,
      };

      await update(policyId, data);
      toast.success(t('pages.policies.messages.updateSuccess'));
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

  if (wrapperLoading || policyLoading) {
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
                {t('pages.policies.editPolicy')}
              </h1>
              <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
                {originalPolicy?.name && (
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {originalPolicy.name}
                  </span>
                )}
              </p>
            </div>

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
          {/* Form Section */}
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
                      isEditMode
                      originalScope={originalPolicy?.scope}
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
                      <Save className="h-4 w-4 mr-2"  />
                      {t('pages.policies.saveChanges')}
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

export default EditPolicyPage;
