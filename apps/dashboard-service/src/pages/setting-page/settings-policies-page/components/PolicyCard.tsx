// ============================================================================
// PolicyCard Component - One policy as a row of the policies list
// ============================================================================

import React from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { Policy, PolicyScope } from '@/server/interfaces/Policy';
import { useEditionEntitlements } from "@/edition/entitlements";
import { cn } from '@/utils/function/utils';
import Button from '@/components/atoms/button/Button';
import { Building, Edit, FileExport, ProjectDiagram, ToggleOff, ToggleOn, Trash, Users } from '@/components/atoms/icon/icons';

import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';
import { AS_TAG } from '@/components/atoms/appsec/recipes';
interface PolicyCardProps {
  policy: Policy;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
  onToggleEnabled: () => void;
  isExporting?: boolean;
}

/** The scope badge: its wording lives in the locale, like every other label. A quiet tag: the glyph says which scope. */
const scopeConfig: Record<PolicyScope, { icon: any; labelKey: string }> = {
  [PolicyScope.ORGANIZATION]: {
    icon: Building,
    labelKey: 'pages.policies.scope.organization',
  },
  [PolicyScope.TEAM]: {
    icon: Users,
    labelKey: 'pages.policies.scope.team',
  },
  [PolicyScope.PROJECT]: {
    icon: ProjectDiagram,
    labelKey: 'pages.policies.scope.project',
  },
};

/** A quiet 32 px icon action of the row; its name is its `aria-label` and tooltip. */
const ACTION = 'w-8 px-0';

/**
 * One policy as a row of the list: the cards with a
 * coloured left edge and a status footer each became a hairline row. The
 * status is the dot before the name and the word in the meta line; scope and
 * priority are quiet tags; rules, exclusions and the last change sit on one
 * line set apart by hairlines; the actions stay on the right, and go under the
 * text on a phone so the name keeps its words.
 */
const PolicyCard: React.FC<PolicyCardProps> = ({
  policy,
  onEdit,
  onDelete,
  onExport,
  onToggleEnabled,
  isExporting = false,
}) => {
  const { t } = useTranslation();
  const writesBlocked = useEditionEntitlements().writesBlocked;
  const blockedTooltip = t('billing.read_only_policy_disabled');
  const scopeInfo = scopeConfig[policy.scope];
  const rulesCount = policy.config.rules?.length || 0;
  const exclusionsCount = policy.config.exclusions?.length || 0;
  const statusWord = policy.isEnabled ? t('pages.policies.status.enabled') : t('pages.policies.status.disabled');

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const toggleLabel = writesBlocked ? blockedTooltip : (policy.isEnabled ? t('pages.policies.disable') : t('pages.policies.enable'));
  const editLabel = writesBlocked ? blockedTooltip : t('pages.policies.editPolicy');
  const deleteLabel = writesBlocked ? blockedTooltip : t('pages.policies.deletePolicy');

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-4 transition-colors duration-[120ms] hover:bg-zinc-50 max-md:flex-wrap sm:px-5 dark:hover:bg-white/[0.03]">
      {/* Policy Info */}
      <div className="min-w-0 flex-1 max-md:basis-full">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {policy.name}
          </h3>

          {/* Scope Badge */}
          <span className={AS_TAG}>
            <scopeInfo.icon className="h-3 w-3 text-zinc-400 dark:text-zinc-500"  />
            {t(scopeInfo.labelKey)}
          </span>

          {/* Priority Badge */}
          <span className={cn(AS_TAG, 'tabular-nums')}>
            {t('pages.policies.priority')}: {policy.priority}
          </span>
        </div>

        {policy.description && (
          <p className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400">
            {policy.description}
          </p>
        )}

        {/* One phrase, its facts after commas (no separator, no dot); the status carries its green itself. */}
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className={policy.isEnabled ? WORD_TONE.good : undefined}>{statusWord}</span>
          {', '}
          <span className="font-mono tabular-nums">{rulesCount}</span> {t('pages.policies.rules.title').toLowerCase()}
          {', '}
          <span className="font-mono tabular-nums">{exclusionsCount}</span> {t('pages.policies.exclusions.title').toLowerCase()}
          {', '}
          {t('pages.policies.lastModified').toLowerCase()} <span className="tabular-nums">{formatDate(policy.updatedAt)}</span>
        </p>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Toggle Enabled: the glyph in green while the policy is on */}
        <Button
          variant="ghost"
          onClick={writesBlocked ? undefined : onToggleEnabled}
          disabled={writesBlocked}
          data-testid={writesBlocked ? `policy-toggle-blocked-${policy.id}` : undefined}
          title={toggleLabel}
          aria-label={toggleLabel}
          aria-pressed={policy.isEnabled}
          className={cn(ACTION, policy.isEnabled && WORD_TONE.good)}
          icon={policy.isEnabled ? <ToggleOn className="h-4 w-4" /> : <ToggleOff className="h-4 w-4" />}
        />

        {/* Export YAML */}
        <Button
          variant="ghost"
          onClick={onExport}
          disabled={isExporting}
          title={t('pages.policies.exportYaml')}
          aria-label={t('pages.policies.exportYaml')}
          className={ACTION}
          icon={
            isExporting ? (
              <span className="block h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
            ) : (
              <FileExport className="h-4 w-4" />
            )
          }
        />

        {/* Edit */}
        <Button
          variant="ghost"
          onClick={writesBlocked ? undefined : onEdit}
          disabled={writesBlocked}
          data-testid={writesBlocked ? `policy-edit-blocked-${policy.id}` : undefined}
          title={editLabel}
          aria-label={editLabel}
          className={ACTION}
          icon={<Edit className="h-4 w-4" />}
        />

        {/* Delete: red glyph, no fill */}
        <Button
          variant="ghost"
          onClick={writesBlocked ? undefined : onDelete}
          disabled={writesBlocked}
          data-testid={writesBlocked ? `policy-delete-blocked-${policy.id}` : undefined}
          title={deleteLabel}
          aria-label={deleteLabel}
          className={cn(ACTION, 'text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/15 dark:hover:text-red-300')}
          icon={<Trash className="h-4 w-4" />}
        />
      </div>
    </div>
  );
};

export default PolicyCard;
