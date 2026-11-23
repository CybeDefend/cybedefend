import { describe, it, expect } from 'vitest';
import {
  parseCvss4Vector,
  CVSS4_METRIC_GROUPS,
  computeCvss4EnvDrivers,
} from './cvss4Vector';

describe('parseCvss4Vector', () => {
  it('returns null when the prefix is missing', () => {
    expect(parseCvss4Vector('AV:N/AC:L')).toBeNull();
  });

  it('returns null when the string is empty', () => {
    expect(parseCvss4Vector('')).toBeNull();
    expect(parseCvss4Vector(null as unknown as string)).toBeNull();
  });

  it('parses the 11 base metrics in canonical order', () => {
    const parsed = parseCvss4Vector(
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.metrics.map((m) => m.key)).toEqual([
      'AV',
      'AC',
      'AT',
      'PR',
      'UI',
      'VC',
      'VI',
      'VA',
      'SC',
      'SI',
      'SA',
    ]);
  });

  it('tags each metric with its group', () => {
    const parsed = parseCvss4Vector(
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
    );
    const byKey = Object.fromEntries(
      parsed!.metrics.map((m) => [m.key, m.group]),
    );
    expect(byKey.AV).toBe('exploitability');
    expect(byKey.UI).toBe('exploitability');
    expect(byKey.VC).toBe('vulnerable');
    expect(byKey.VA).toBe('vulnerable');
    expect(byKey.SC).toBe('subsequent');
    expect(byKey.SA).toBe('subsequent');
  });

  it('exposes the value alongside the key', () => {
    const parsed = parseCvss4Vector(
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
    );
    const byKey = Object.fromEntries(
      parsed!.metrics.map((m) => [m.key, m.value]),
    );
    expect(byKey.AV).toBe('N');
    expect(byKey.AC).toBe('L');
    expect(byKey.VC).toBe('H');
  });

  it('ignores unknown metrics silently and keeps known ones', () => {
    const parsed = parseCvss4Vector(
      'CVSS:4.0/AV:N/AC:L/XX:Y/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.metrics.find((m) => m.key === 'XX')).toBeUndefined();
    expect(parsed!.metrics.find((m) => m.key === 'AV')?.value).toBe('N');
  });

  it('rejects a value that is not part of the metric enum', () => {
    // AV only accepts N/A/L/P — Z is invalid and must be dropped.
    const parsed = parseCvss4Vector(
      'CVSS:4.0/AV:Z/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.metrics.find((m) => m.key === 'AV')).toBeUndefined();
  });

  it('exposes a stable group catalogue for UI grouping', () => {
    expect(CVSS4_METRIC_GROUPS).toEqual([
      'exploitability',
      'vulnerable',
      'subsequent',
      'requirements',
      'modified',
    ]);
  });

  it('should parse environmental metrics CR/IR/AR and modified components', () => {
    const vector =
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H/IR:M/AR:L/MAV:N/MSC:H/MSI:H';
    const parsed = parseCvss4Vector(vector);
    expect(parsed).not.toBeNull();
    const keys = parsed!.metrics.map((m) => m.key);
    expect(keys).toContain('CR');
    expect(keys).toContain('IR');
    expect(keys).toContain('AR');
    expect(keys).toContain('MAV');
    expect(keys).toContain('MSC');
    expect(keys).toContain('MSI');
  });

  it('should assign requirements group to CR/IR/AR', () => {
    const parsed = parseCvss4Vector(
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:H',
    );
    const cr = parsed!.metrics.find((m) => m.key === 'CR');
    expect(cr!.group).toBe('requirements');
  });

  it('should assign modified group to MAV/MSC/etc', () => {
    const parsed = parseCvss4Vector(
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/MAV:N',
    );
    const mav = parsed!.metrics.find((m) => m.key === 'MAV');
    expect(mav!.group).toBe('modified');
  });

  it('should filter out X (Not Defined) metric values', () => {
    const parsed = parseCvss4Vector(
      'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/CR:X/IR:X/AR:H',
    );
    expect(parsed).not.toBeNull();
    const keys = parsed!.metrics.map((m) => m.key);
    expect(keys).not.toContain('CR'); // X filtered out
    expect(keys).not.toContain('IR');
    expect(keys).toContain('AR'); // kept (value is H)
  });
});

describe('computeCvss4EnvDrivers', () => {
  const BASE =
    'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

  it('returns empty arrays when no environmental vector is provided', () => {
    expect(computeCvss4EnvDrivers(BASE, null)).toEqual({
      requirements: [],
      modified: [],
    });
    expect(computeCvss4EnvDrivers(BASE, undefined)).toEqual({
      requirements: [],
      modified: [],
    });
    expect(computeCvss4EnvDrivers(BASE, '')).toEqual({
      requirements: [],
      modified: [],
    });
  });

  it('returns empty arrays when env vector equals base vector', () => {
    expect(computeCvss4EnvDrivers(BASE, BASE)).toEqual({
      requirements: [],
      modified: [],
    });
  });

  it('captures CR/IR/AR in requirements with their values', () => {
    const env = `${BASE}/CR:H/IR:M/AR:L`;
    const drivers = computeCvss4EnvDrivers(BASE, env);
    expect(drivers.requirements).toEqual([
      { key: 'CR', value: 'H' },
      { key: 'IR', value: 'M' },
      { key: 'AR', value: 'L' },
    ]);
    expect(drivers.modified).toEqual([]);
  });

  it('marks a modified metric as unchanged when value matches the base', () => {
    // Base AV:N, env override MAV:N -> same value, changed=false
    const env = `${BASE}/MAV:N`;
    const drivers = computeCvss4EnvDrivers(BASE, env);
    expect(drivers.modified).toEqual([
      {
        key: 'MAV',
        value: 'N',
        baseKey: 'AV',
        baseValue: 'N',
        changed: false,
      },
    ]);
  });

  it('marks a modified metric as changed with the base value when it overrides', () => {
    // Base SC:N, env override MSC:H -> diff
    const env = `${BASE}/MSC:H/MSI:H/MSA:H`;
    const drivers = computeCvss4EnvDrivers(BASE, env);
    expect(drivers.modified).toEqual([
      {
        key: 'MSC',
        value: 'H',
        baseKey: 'SC',
        baseValue: 'N',
        changed: true,
      },
      {
        key: 'MSI',
        value: 'H',
        baseKey: 'SI',
        baseValue: 'N',
        changed: true,
      },
      {
        key: 'MSA',
        value: 'H',
        baseKey: 'SA',
        baseValue: 'N',
        changed: true,
      },
    ]);
  });

  it('captures CR/IR/AR and modified metrics together when both are present', () => {
    const env = `${BASE}/CR:H/IR:H/AR:H/MSC:H/MSI:H/MSA:H`;
    const drivers = computeCvss4EnvDrivers(BASE, env);
    expect(drivers.requirements.map((r) => r.key)).toEqual(['CR', 'IR', 'AR']);
    expect(drivers.modified.map((m) => m.key)).toEqual([
      'MSC',
      'MSI',
      'MSA',
    ]);
    expect(drivers.modified.every((m) => m.changed)).toBe(true);
  });

  it('omits the base info when the base vector cannot be parsed', () => {
    // No base vector -> the modified entries still surface (the env vector is
    // the source of truth). baseKey is structural so it is always derivable;
    // baseValue/changed stay undefined because there is nothing to compare to.
    const env = `${BASE}/MSC:H`;
    const drivers = computeCvss4EnvDrivers(null, env);
    expect(drivers.modified).toEqual([
      {
        key: 'MSC',
        value: 'H',
        baseKey: 'SC',
        baseValue: undefined,
        changed: undefined,
      },
    ]);
  });

  it('returns empty arrays when env vector cannot be parsed', () => {
    expect(computeCvss4EnvDrivers(BASE, 'not-a-vector')).toEqual({
      requirements: [],
      modified: [],
    });
  });

  it('preserves CR/IR/AR even when MAV/MSC/etc. happen to match base', () => {
    const env = `${BASE}/CR:H/MAV:N`;
    const drivers = computeCvss4EnvDrivers(BASE, env);
    expect(drivers.requirements).toEqual([{ key: 'CR', value: 'H' }]);
    expect(drivers.modified).toEqual([
      {
        key: 'MAV',
        value: 'N',
        baseKey: 'AV',
        baseValue: 'N',
        changed: false,
      },
    ]);
  });
});
