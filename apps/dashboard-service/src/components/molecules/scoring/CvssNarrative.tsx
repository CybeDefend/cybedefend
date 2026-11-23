import React from 'react';
import { useTranslation, type TFunction } from 'react-i18next';
import type {
  CvssBaseExplanation,
  CvssEnvDriver,
  CvssEnvironmentalExplanation,
  CvssExplanation,
} from '@/server/interfaces/Vulnerability';

interface CvssNarrativeProps {
  explanation?: CvssExplanation | null;
}

const NS_PREFIX = 'pages.issuePage.scoring.cvss.narrative';

function pickImpactKey(base: CvssBaseExplanation): string {
  const c = base.confidentialityImpact === 'high';
  const i = base.integrityImpact === 'high';
  const a = base.availabilityImpact === 'high';
  if (c && i && a) return 'fullCia';
  if (c && i) return 'ci';
  if (c && a) return 'ca';
  if (i && a) return 'ia';
  if (c) return 'c';
  if (i) return 'i';
  if (a) return 'a';
  const anyLow =
    base.confidentialityImpact === 'low' ||
    base.integrityImpact === 'low' ||
    base.availabilityImpact === 'low';
  return anyLow ? 'low' : 'none';
}

function joinDrivers(
  drivers: CvssEnvDriver[],
  t: TFunction,
): string {
  const labels = drivers.map((d) =>
    t(`${NS_PREFIX}.drivers.${d.metricKey}.${d.value}`),
  );
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2)
    return labels.join(t(`${NS_PREFIX}.env.driverLastSeparator`));
  const head = labels.slice(0, -1).join(t(`${NS_PREFIX}.env.driverSeparator`));
  return head + t(`${NS_PREFIX}.env.driverLastSeparator`) + labels[labels.length - 1];
}

const BaseSentence: React.FC<{
  base: CvssBaseExplanation;
  t: TFunction;
}> = ({ base, t }) => {
  const intro = t(`${NS_PREFIX}.intro`, {
    score: base.baseScore.toFixed(1),
    severityLabel: t(`${NS_PREFIX}.severity.${base.severity}`),
  });
  const attacker = t(`${NS_PREFIX}.attacker.${base.attackOrigin}`);
  const auth = t(`${NS_PREFIX}.auth.${base.authRequired}`);
  const interaction = t(`${NS_PREFIX}.interaction.${base.userInteraction}`);
  const complexity = t(`${NS_PREFIX}.complexity.${base.attackComplexity}`);
  const action = t(`${NS_PREFIX}.actionVerb`);
  const impact = t(`${NS_PREFIX}.impact.${pickImpactKey(base)}`);
  const subsequent = base.hasSubsequentImpact
    ? t(`${NS_PREFIX}.subsequent`)
    : '';

  return (
    <p
      data-testid="cvss-narrative-base"
      className="text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed"
    >
      <span className="font-semibold">{intro}</span>{' '}
      {attacker} {auth} {interaction} {complexity} {action} {impact}
      {subsequent}
    </p>
  );
};

const EnvSentence: React.FC<{
  environmental: CvssEnvironmentalExplanation;
  t: TFunction;
}> = ({ environmental, t }) => {
  if (environmental.direction === 'unchanged') return null;

  const intro = t(`${NS_PREFIX}.env.intro`, {
    envScore: environmental.envScore.toFixed(1),
  });
  const drivers = joinDrivers(environmental.drivers, t);
  const body = t(`${NS_PREFIX}.env.${environmental.direction}`, {
    drivers: drivers || t(`${NS_PREFIX}.env.unchangedNoText`),
  });

  return (
    <p
      data-testid="cvss-narrative-env"
      className="text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed mt-2"
    >
      <span className="font-semibold">{intro}</span> {body}
    </p>
  );
};

const CvssNarrative: React.FC<CvssNarrativeProps> = ({ explanation }) => {
  const { t } = useTranslation();

  if (!explanation) return null;
  const { base, environmental } = explanation;
  if (!base && !environmental) return null;

  return (
    <div className="space-y-1">
      {base ? <BaseSentence base={base} t={t} /> : null}
      {environmental ? (
        <EnvSentence environmental={environmental} t={t} />
      ) : null}
    </div>
  );
};

export default CvssNarrative;
