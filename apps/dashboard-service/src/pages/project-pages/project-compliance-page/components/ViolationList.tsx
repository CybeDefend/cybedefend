// ============================================================================
// ViolationList - List of policy violations with actions
// ============================================================================

import React, { useState } from 'react';
import SeverityChip from '@/components/atoms/badge/SeverityChip';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

import { PolicyViolation, AffectedVulnerability } from '@/server/interfaces/Policy';
import { cn, getSeverityVariant } from '@/utils/function/utils';
import { projectPath } from '@/utils/product';
import Card from '@/components/atoms/card';
import Button from '@/components/atoms/button/Button';
import Pagination from '@/components/molecules/pagination/Pagination';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Code, CodeBranch, Cogs, Cubes, ExclamationTriangle, File, Key, ShieldAlt, Sync } from '@/components/atoms/icon/icons';
import { AS_PANEL_TITLE, AS_SENTENCE_CASE, AS_TAG, AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import Badge from '@/components/atoms/badge/Badge';

interface ViolationListProps {
  violations: PolicyViolation[];
  loading: boolean;
  error: string | null;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
}


const ViolationList: React.FC<ViolationListProps> = ({
  violations,
  loading,
  error,
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();

  // Track which violations have their vulnerabilities expanded
  const [expandedViolations, setExpandedViolations] = useState<Set<string>>(new Set());

  const toggleViolationExpanded = (violationId: string) => {
    setExpandedViolations((prev) => {
      const next = new Set(prev);
      if (next.has(violationId)) {
        next.delete(violationId);
      } else {
        next.add(violationId);
      }
      return next;
    });
  };

  // Get icon for vulnerability type
  const getVulnTypeIcon = (type: string) => {
    switch (type) {
      case 'sast':
        return Code;
      case 'sca':
        return Cubes;
      case 'iac':
        return ShieldAlt;
      case 'secret':
        return Key;
      case 'cicd':
        return Cogs;
      default:
        return ExclamationTriangle;
    }
  };

  // Navigate to vulnerability detail
  const handleVulnerabilityClick = (vuln: AffectedVulnerability) => {
    if (!projectId) return;

    // License violations have synthetic IDs like "license-strong_copyleft-{ruleId}"
    // Navigate to the SCA licenses tab instead of a non-existent issue page
    if (vuln.id.startsWith('license-')) {
      if (vuln.branch) {
        localStorage.setItem(`selectedBranch_${projectId}`, vuln.branch);
      }
      navigate(`${projectPath('appsec', projectId, 'sca')}?tab=licenses`);
      window.scrollTo(0, 0);
      return;
    }

    // Navigate to the AppSec page of the finding: /appsec/project/{projectId}/{type}/issue/{vulnId}
    navigate(projectPath('appsec', projectId, `${vuln.vulnerabilityType}/issue/${vuln.id}`));
    window.scrollTo(0, 0);
  };

  // Map actionTaken to severity level for display
  const getActionSeverity = (actionTaken: string): string => {
    const action = actionTaken.toUpperCase();
    switch (action) {
      case 'WARN':
        return 'warning';
      case 'BLOCK':
        return 'blocking';
      default:
        return 'medium';
    }
  };

  // Get display label for actionTaken
  const getActionLabel = (actionTaken: string): string => {
    const action = actionTaken.toUpperCase();
    switch (action) {
      case 'WARN':
        return t('pages.policies.violations.warning');
      case 'BLOCK':
        return t('pages.policies.violations.blocking');
      default:
        return t('pages.policies.violations.unspecified');
    }
  };

  // Human-readable labels for rule types
  const ruleTypeLabels: Record<string, string> = {
    'severity': t('pages.policies.ruleTypes.severity'),
    'cvss_score': t('pages.policies.ruleTypes.cvssScore'),
    'vulnerability_type': t('pages.policies.ruleTypes.vulnerabilityType'),
    'vulnerability_age_days': t('pages.policies.ruleTypes.vulnerabilityAgeDays'),
    'branch': t('pages.policies.ruleTypes.branch'),
    'cwe': t('pages.policies.ruleTypes.cwe'),
    'owasp_top_10': t('pages.policies.ruleTypes.owaspTop10'),
    'package_name': t('pages.policies.ruleTypes.packageName'),
    'file_path': t('pages.policies.ruleTypes.filePath'),
  };

  // Human-readable operators
  const operatorLabels: Record<string, string> = {
    'equals': '=',
    'not_equals': '≠',
    'gt': '>',
    'gte': '≥',
    'greater_than': '>',
    'greater_than_or_equal': '≥',
    'lt': '<',
    'lte': '≤',
    'less_than': '<',
    'less_than_or_equal': '≤',
    'in': t('pages.policies.operators.in'),
    'not_in': t('pages.policies.operators.notIn'),
    'contains': t('pages.policies.operators.contains'),
    'not_contains': t('pages.policies.operators.notContains'),
  };

  // Format a single criterion as a readable string
  const formatCriterion = (type: string, operator: string, value: string | number | string[]): string => {
    const typeLabel = ruleTypeLabels[type] || type;
    const op = operatorLabels[operator?.toLowerCase()] || operator || '=';
    
    let formattedValue: string;
    if (Array.isArray(value)) {
      formattedValue = value.join(', ');
    } else if (typeof value === 'string') {
      formattedValue = value;
    } else {
      formattedValue = String(value);
    }
    
    return `${typeLabel} ${op} ${formattedValue}`;
  };

  // Render rule conditions as visual badges
  const renderRuleConditions = (rule: PolicyViolation['rule']) => {
    // Handle composite rules
    if (rule.type === 'composite_and' || rule.type === 'composite_or') {
      if (!rule.criteria || rule.criteria.length === 0) {
        return (
          <span className="text-xs text-zinc-500 dark:text-zinc-400 italic">
            {rule.name}
          </span>
        );
      }

      const separatorLabel = rule.type === 'composite_and' 
        ? t('pages.policies.operators.and') 
        : t('pages.policies.operators.or');

      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {rule.criteria.map((criterion, index) => (
            <React.Fragment key={criterion.id || index}>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-zinc-100 dark:bg-as-raised text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-as-line-strong">
                {formatCriterion(criterion.type, criterion.operator, criterion.value)}
              </span>
              {index < rule.criteria!.length - 1 && (
                <span className="text-xs font-semibold text-secondary dark:text-secondary-light">
                  {separatorLabel}
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      );
    }

    // Handle simple rules
    if (!rule.operator || rule.value === undefined) {
      return (
        <span className="text-xs text-zinc-500 dark:text-zinc-400 italic">
          {rule.name}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-zinc-100 dark:bg-as-raised text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-as-line-strong">
        {formatCriterion(rule.type, rule.operator, rule.value)}
      </span>
    );
  };

  const formatDate = (timestamp: number | string | null | undefined) => {
    if (!timestamp) return '';
    const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} variant="default" padding="md">
            <div className="animate-pulse">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="h-5 bg-zinc-200 dark:bg-as-raised rounded w-2/3 mb-2" />
                  <div className="h-4 bg-zinc-200 dark:bg-as-raised rounded w-1/2 mb-3" />
                  <div className="h-3 bg-zinc-200 dark:bg-as-raised rounded w-1/4" />
                </div>
                <div className="h-8 w-24 bg-zinc-200 dark:bg-as-raised rounded-xl" />
              </div>
            </div>
          </Card>
        ))}
      </div>
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

  if (violations.length === 0) {
    return (
      <Card variant="default" padding="lg" className="text-center">
        <div className="py-8">
          {/* A green check, no tinted tile. */}
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
            <CheckCircle className="h-8 w-8 text-emerald-500" />
          </div>
          <h3 className={cn(AS_PANEL_TITLE, 'mb-2')}>
            {t('pages.projectCompliance.noViolations')}
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('pages.projectCompliance.noViolationsDescription')}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('pages.projectCompliance.showingViolations', {
            count: violations.length,
          })}
        </p>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <Sync className="h-4 w-4 mr-1"  />
          {t('common.refresh')}
        </Button>
      </div>

      {/* Violations List */}
      <AnimatePresence mode="popLayout">
        {violations.map((violation, index) => {
          const actionSeverity = getActionSeverity(violation.actionTaken);

          return (
            <motion.div
              key={violation.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: index * 0.03 }}
            >
              <Card
                variant="default"
                padding="none"
                hoverable
                className="overflow-hidden"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4 max-md:flex-wrap max-md:gap-2">
                    {/* Violation Info */}
                    <div className="flex-1 min-w-0 max-md:basis-full">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        {/* Action Badge */}
                        <Badge
                          variant={actionSeverity === 'blocking' ? 'error' : actionSeverity === 'warning' ? 'warning' : 'default'}
                          size="sm"
                          appearance="dot"
                        >
                          {getActionLabel(violation.actionTaken)}
                        </Badge>

                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {violation.rule.name}
                        </span>
                      </div>

                      <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-2">
                        {violation.rule.description}
                      </p>

                      {/* Rule Condition */}
                      <div className="mb-2">
                        {renderRuleConditions(violation.rule)}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400 flex-wrap">
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5"  />
                          {violation.affectedVulnerabilitiesCount} {t('pages.policies.violations.affectedVulnerabilities')}
                        </span>
                        <span>
                          {t('pages.projectCompliance.createdAt')}: {formatDate(violation.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* Expand/Collapse Button */}
                    {violation.affectedVulnerabilities && violation.affectedVulnerabilities.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleViolationExpanded(violation.id)}
                        className="flex-shrink-0"
                      >
                        {expandedViolations.has(violation.id) ? <ChevronUp
                          className="h-4 w-4 mr-1" /> : <ChevronDown
                          className="h-4 w-4 mr-1" />}
                        {expandedViolations.has(violation.id)
                          ? t('common.collapse')
                          : t('pages.policies.violations.showVulnerabilities')}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Affected Vulnerabilities List (Expandable) */}
                <AnimatePresence>
                  {expandedViolations.has(violation.id) && violation.affectedVulnerabilities && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-zinc-200 dark:border-as-line bg-zinc-50 dark:bg-white/[0.03] max-h-80 overflow-y-auto">
                        <div className="divide-y divide-zinc-200 dark:divide-as-line">
                          {violation.affectedVulnerabilities.map((vuln) => {
                            return (
                              <div
                                key={vuln.id}
                                onClick={() => handleVulnerabilityClick(vuln)}
                                className="px-4 py-3 hover:bg-zinc-100 dark:hover:bg-white/[0.06] cursor-pointer transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  {/* Vuln Type Icon */}
                                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                                    {React.createElement(getVulnTypeIcon(vuln.vulnerabilityType), { className: 'h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400' })}
                                  </div>

                                  {/* Vuln Info */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                        {vuln.name}
                                      </span>
                                      <SeverityChip level={getSeverityVariant(vuln.severity)}>
                                        <span className={AS_SENTENCE_CASE}>{vuln.severity}</span>
                                      </SeverityChip>
                                      {vuln.cvssScore && (
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                          CVSS: {vuln.cvssScore}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                      {vuln.branch && (
                                        <>
                                          <CodeBranch className="h-4.5 w-4.5"  />
                                          <span className="truncate max-w-[100px]">{vuln.branch}</span>
                                        </>
                                      )}
                                      <File className="h-4.5 w-4.5"  />
                                      <span className="truncate max-w-[460px]">{vuln.filePath}</span>
                                      {vuln.startLine && (
                                        <span>L{vuln.startLine}{vuln.endLine && vuln.endLine !== vuln.startLine ? `-${vuln.endLine}` : ''}</span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Type Badge */}
                                  <span className={`${AS_TAG} flex-shrink-0 uppercase`}>
                                    {vuln.vulnerabilityType}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Status Bar: a hairline row, the action written in its colour (no dot). */}
                <div className="px-4 py-2 border-t border-zinc-200 dark:border-as-line flex items-center gap-2">
                  <span
                    className={cn(
                      'text-xs font-medium',
                      actionSeverity === 'blocking'
                        ? AS_WORD_TONE.bad
                        : actionSeverity === 'warning'
                          ? AS_WORD_TONE.warning
                          : 'text-zinc-700 dark:text-zinc-200',
                    )}
                  >
                    {getActionLabel(violation.actionTaken)}
                  </span>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-6">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            compact
          />
        </div>
      )}
    </div>
  );
};

export default ViolationList;
