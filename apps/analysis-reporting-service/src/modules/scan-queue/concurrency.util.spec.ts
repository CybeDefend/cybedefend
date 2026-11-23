import { resolveConcurrency } from './concurrency.util';
import {
  QUEUE_CONCURRENCY_CONFIG,
  getQueueConcurrency,
} from './concurrency.config';
import { QUEUE_NAMES } from './queue-names';

describe('resolveConcurrency', () => {
  describe('returns the fallback when the env value is absent or invalid', () => {
    it('returns fallback for undefined', () => {
      expect(resolveConcurrency(undefined, 3)).toBe(3);
    });

    it('returns fallback for empty string', () => {
      expect(resolveConcurrency('', 3)).toBe(3);
    });

    it('returns fallback for a non-numeric string', () => {
      expect(resolveConcurrency('abc', 3)).toBe(3);
    });

    it('returns fallback for "0"', () => {
      expect(resolveConcurrency('0', 3)).toBe(3);
    });

    it('returns fallback for a negative value', () => {
      expect(resolveConcurrency('-2', 3)).toBe(3);
    });

    it('returns fallback for a float string (no silent truncation)', () => {
      expect(resolveConcurrency('2.5', 3)).toBe(3);
    });

    it('returns fallback for a digit-prefixed non-integer string', () => {
      expect(resolveConcurrency('3abc', 1)).toBe(1);
    });
  });

  describe('returns the parsed value when valid', () => {
    it('parses "5" to 5', () => {
      expect(resolveConcurrency('5', 1)).toBe(5);
    });

    it('parses "1" to 1', () => {
      expect(resolveConcurrency('1', 3)).toBe(1);
    });

    it('parses "10" to 10', () => {
      expect(resolveConcurrency('10', 1)).toBe(10);
    });
  });
});

describe('QUEUE_CONCURRENCY_CONFIG defaults', () => {
  it('has an entry for every QUEUE_NAMES key', () => {
    const configKeys = Object.keys(QUEUE_CONCURRENCY_CONFIG).sort();
    const queueKeys = Object.keys(QUEUE_NAMES).sort();
    expect(configKeys).toEqual(queueKeys);
  });

  it('SCA defaults to 3 via SCA_CONCURRENCY', () => {
    const { envVar, defaultConcurrency } = QUEUE_CONCURRENCY_CONFIG.SCA;
    expect(envVar).toBe('SCA_CONCURRENCY');
    expect(defaultConcurrency).toBe(3);
  });

  it('SAST_IAC defaults to 3 via SAST_IAC_CONCURRENCY', () => {
    const { envVar, defaultConcurrency } = QUEUE_CONCURRENCY_CONFIG.SAST_IAC;
    expect(envVar).toBe('SAST_IAC_CONCURRENCY');
    expect(defaultConcurrency).toBe(3);
  });

  it('CONTAINER defaults to 3 via CONTAINER_CONCURRENCY', () => {
    const { envVar, defaultConcurrency } = QUEUE_CONCURRENCY_CONFIG.CONTAINER;
    expect(envVar).toBe('CONTAINER_CONCURRENCY');
    expect(defaultConcurrency).toBe(3);
  });

  it('CVSS_RECALCULATION defaults to 1 via CVSS_CONCURRENCY', () => {
    const { envVar, defaultConcurrency } =
      QUEUE_CONCURRENCY_CONFIG.CVSS_RECALCULATION;
    expect(envVar).toBe('CVSS_CONCURRENCY');
    expect(defaultConcurrency).toBe(1);
  });

  // The AGENT_REANALYSIS case is in a closed spec.

  it('CYBERISK_RECOMPUTE defaults to 4 via CYBERISK_CONCURRENCY', () => {
    const { envVar, defaultConcurrency } =
      QUEUE_CONCURRENCY_CONFIG.CYBERISK_RECOMPUTE;
    expect(envVar).toBe('CYBERISK_CONCURRENCY');
    expect(defaultConcurrency).toBe(4);
  });

  it('REPORTS defaults to 1 via REPORTS_CONCURRENCY', () => {
    const { envVar, defaultConcurrency } = QUEUE_CONCURRENCY_CONFIG.REPORTS;
    expect(envVar).toBe('REPORTS_CONCURRENCY');
    expect(defaultConcurrency).toBe(1);
  });

  it('AGGREGATED_REPORTS defaults to 1 via AGGREGATED_REPORTS_CONCURRENCY', () => {
    const { envVar, defaultConcurrency } =
      QUEUE_CONCURRENCY_CONFIG.AGGREGATED_REPORTS;
    expect(envVar).toBe('AGGREGATED_REPORTS_CONCURRENCY');
    expect(defaultConcurrency).toBe(1);
  });

  // The SCA_AUTOFIX case is in a closed spec.
});

describe('getQueueConcurrency (env integration)', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    // Restore any env vars touched during the test
    Object.keys(QUEUE_CONCURRENCY_CONFIG).forEach((key) => {
      const { envVar } =
        QUEUE_CONCURRENCY_CONFIG[key as keyof typeof QUEUE_NAMES];
      if (ORIGINAL[envVar] === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = ORIGINAL[envVar];
      }
    });
  });

  it('returns the default when env var is unset', () => {
    delete process.env.SCA_CONCURRENCY;
    expect(getQueueConcurrency('SCA')).toBe(3);
  });

  it('returns the parsed env value when valid', () => {
    process.env.SCA_CONCURRENCY = '5';
    expect(getQueueConcurrency('SCA')).toBe(5);
  });

  it('returns the default when env var is invalid', () => {
    process.env.SAST_IAC_CONCURRENCY = 'not-a-number';
    expect(getQueueConcurrency('SAST_IAC')).toBe(3);
  });

  it('returns the default for CYBERISK_RECOMPUTE when env var is unset', () => {
    delete process.env.CYBERISK_CONCURRENCY;
    expect(getQueueConcurrency('CYBERISK_RECOMPUTE')).toBe(4);
  });

  it('allows operator override of CYBERISK_RECOMPUTE via env var', () => {
    process.env.CYBERISK_CONCURRENCY = '8';
    expect(getQueueConcurrency('CYBERISK_RECOMPUTE')).toBe(8);
  });
});
