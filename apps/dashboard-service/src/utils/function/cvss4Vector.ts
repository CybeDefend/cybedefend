export type Cvss4MetricGroup =
  | 'exploitability'
  | 'vulnerable'
  | 'subsequent'
  | 'requirements'
  | 'modified';

export const CVSS4_METRIC_GROUPS: Cvss4MetricGroup[] = [
  'exploitability',
  'vulnerable',
  'subsequent',
  'requirements',
  'modified',
];

interface Cvss4MetricSpec {
  key: string;
  group: Cvss4MetricGroup;
  values: string[];
}

const METRIC_SPECS: Cvss4MetricSpec[] = [
  { key: 'AV', group: 'exploitability', values: ['N', 'A', 'L', 'P'] },
  { key: 'AC', group: 'exploitability', values: ['L', 'H'] },
  { key: 'AT', group: 'exploitability', values: ['N', 'P'] },
  { key: 'PR', group: 'exploitability', values: ['N', 'L', 'H'] },
  { key: 'UI', group: 'exploitability', values: ['N', 'P', 'A'] },
  { key: 'VC', group: 'vulnerable', values: ['H', 'L', 'N'] },
  { key: 'VI', group: 'vulnerable', values: ['H', 'L', 'N'] },
  { key: 'VA', group: 'vulnerable', values: ['H', 'L', 'N'] },
  { key: 'SC', group: 'subsequent', values: ['H', 'L', 'N'] },
  { key: 'SI', group: 'subsequent', values: ['H', 'L', 'N'] },
  { key: 'SA', group: 'subsequent', values: ['H', 'L', 'N'] },
  // security requirements (default X = Not Defined, treated as H per spec)
  { key: 'CR', group: 'requirements', values: ['H', 'M', 'L', 'X'] },
  { key: 'IR', group: 'requirements', values: ['H', 'M', 'L', 'X'] },
  { key: 'AR', group: 'requirements', values: ['H', 'M', 'L', 'X'] },
  // modified base metrics (default X = inherit from base)
  { key: 'MAV', group: 'modified', values: ['N', 'A', 'L', 'P', 'X'] },
  { key: 'MAC', group: 'modified', values: ['L', 'H', 'X'] },
  { key: 'MAT', group: 'modified', values: ['N', 'P', 'X'] },
  { key: 'MPR', group: 'modified', values: ['N', 'L', 'H', 'X'] },
  { key: 'MUI', group: 'modified', values: ['N', 'P', 'A', 'X'] },
  { key: 'MVC', group: 'modified', values: ['H', 'L', 'N', 'X'] },
  { key: 'MVI', group: 'modified', values: ['H', 'L', 'N', 'X'] },
  { key: 'MVA', group: 'modified', values: ['H', 'L', 'N', 'X'] },
  { key: 'MSC', group: 'modified', values: ['H', 'L', 'N', 'X'] },
  { key: 'MSI', group: 'modified', values: ['S', 'H', 'L', 'N', 'X'] },
  { key: 'MSA', group: 'modified', values: ['S', 'H', 'L', 'N', 'X'] },
];

const METRIC_BY_KEY = new Map(METRIC_SPECS.map((m) => [m.key, m]));

export interface Cvss4ParsedMetric {
  key: string;
  value: string;
  group: Cvss4MetricGroup;
}

export interface Cvss4ParsedVector {
  metrics: Cvss4ParsedMetric[];
}

const VECTOR_PREFIX = 'CVSS:4.0/';

export function parseCvss4Vector(
  vector: string | null | undefined,
): Cvss4ParsedVector | null {
  if (!vector || typeof vector !== 'string') return null;
  if (!vector.startsWith(VECTOR_PREFIX)) return null;

  const parts = vector.slice(VECTOR_PREFIX.length).split('/');
  const seen = new Set<string>();
  const raw = new Map<string, string>();

  for (const part of parts) {
    const [key, value] = part.split(':');
    if (!key || !value || seen.has(key)) continue;
    const spec = METRIC_BY_KEY.get(key);
    if (!spec) continue;
    if (!spec.values.includes(value)) continue;
    seen.add(key);
    raw.set(key, value);
  }

  const metrics: Cvss4ParsedMetric[] = [];
  for (const spec of METRIC_SPECS) {
    const value = raw.get(spec.key);
    if (value === undefined) continue;
    if (value === 'X') continue; // hide "Not Defined" — equivalent to using base value
    metrics.push({ key: spec.key, value, group: spec.group });
  }

  return { metrics };
}

export interface Cvss4EnvDriver {
  key: string;
  value: string;
  baseKey?: string;
  baseValue?: string;
  changed?: boolean;
}

export interface Cvss4EnvDrivers {
  requirements: Cvss4EnvDriver[];
  modified: Cvss4EnvDriver[];
}

export function computeCvss4EnvDrivers(
  baseVector: string | null | undefined,
  envVector: string | null | undefined,
): Cvss4EnvDrivers {
  if (!envVector || envVector === baseVector) {
    return { requirements: [], modified: [] };
  }
  const env = parseCvss4Vector(envVector);
  if (!env) return { requirements: [], modified: [] };

  const base = parseCvss4Vector(baseVector);
  const baseByKey = new Map<string, string>();
  if (base) {
    for (const m of base.metrics) {
      baseByKey.set(m.key, m.value);
    }
  }

  const requirements: Cvss4EnvDriver[] = [];
  const modified: Cvss4EnvDriver[] = [];
  for (const m of env.metrics) {
    if (m.group === 'requirements') {
      requirements.push({ key: m.key, value: m.value });
      continue;
    }
    if (m.group === 'modified') {
      const baseKey = m.key.startsWith('M') ? m.key.slice(1) : undefined;
      const baseValue = baseKey ? baseByKey.get(baseKey) : undefined;
      modified.push({
        key: m.key,
        value: m.value,
        baseKey,
        baseValue,
        changed: baseValue !== undefined ? baseValue !== m.value : undefined,
      });
    }
  }

  return { requirements, modified };
}
