import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { PolicyEvaluationProcessor } from './policy-evaluation.processor';
import { PolicyEvaluation } from '@entities/policy-evaluation.entity';
import { PolicyViolation } from '@entities/policy-violation.entity';
import { SecurityPolicy } from '@entities/security-policy.entity';
import { PolicyService } from '@modules/policy/policy.service';
import { PolicyYamlService } from '@modules/policy/policy-yaml.service';
import { PolicyValidationService } from '@modules/policy/policy-validation.service';
import { of, throwError } from 'rxjs';
import type { Job } from 'bullmq';
import type { PolicyEvaluationJobData } from '../evaluation-queue.service';
import {
  ORGANIZATION_SERVICE_NAME,
  PROJECT_SERVICE_NAME,
  TEAM_SERVICE_NAME,
} from '@core/grpc/global-management/global_management';
import {
  PolicyRule,
  PolicyExclusion,
  ViolationAction,
  RuleType,
  RuleOperator,
} from '@entities/security-policy.entity';

/**
 * Vulnerability data for testing (mirrors the processor interface)
 */
interface VulnerabilityData {
  id: string;
  name: string;
  severity: string;
  cvssScore?: number;
  cwe?: string[];
  owaspCategory?: string;
  scannerType: string;
  filePath?: string;
  lineNumber?: number;
  isNew?: boolean;
  status?: string;
  createdAt?: number;
}

/**
 * Scan context for rule evaluation
 */
interface ScanContext {
  scanId: string;
  branch?: string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const picomatch = require('picomatch') as {
  (patterns: string | string[]): (path: string) => boolean;
  isMatch: (path: string, pattern: string | string[]) => boolean;
};

/**
 * Pure functions extracted from PolicyEvaluationProcessor for unit testing.
 * These functions can be tested in isolation without mocking the entire NestJS infrastructure.
 */

/**
 * Compare values using the specified operator
 */
function compareValues(
  actual: unknown,
  expected: unknown,
  operator: RuleOperator,
): boolean {
  switch (operator) {
    case RuleOperator.EQUALS:
      return actual === expected;
    case RuleOperator.NOT_EQUALS:
      return actual !== expected;
    case RuleOperator.GT:
      return (actual as number) > (expected as number);
    case RuleOperator.GTE:
      return (actual as number) >= (expected as number);
    case RuleOperator.LT:
      return (actual as number) < (expected as number);
    case RuleOperator.LTE:
      return (actual as number) <= (expected as number);
    case RuleOperator.IN:
      if (Array.isArray(expected)) {
        return expected.includes(actual);
      }
      return false;
    case RuleOperator.NOT_IN:
      if (Array.isArray(expected)) {
        return !expected.includes(actual);
      }
      return true;
    default:
      return false;
  }
}

/**
 * Evaluate a simple (non-composite) rule
 */
function evaluateSimpleRule(
  rule: PolicyRule,
  vulnerability: VulnerabilityData,
  scanContext: ScanContext,
): {
  matches: boolean;
  condition: string;
  matchedValues: Record<string, unknown>[];
} {
  const operator = rule.operator || RuleOperator.EQUALS;
  let matches = false;
  let actualValue: unknown = null;
  let condition = '';

  switch (rule.type) {
    case RuleType.SEVERITY:
      actualValue = vulnerability.severity?.toUpperCase();
      matches = compareValues(actualValue, rule.value, operator);
      condition = `severity ${operator} ${rule.value}`;
      break;

    case RuleType.CVSS_SCORE:
      actualValue = vulnerability.cvssScore || 0;
      matches = compareValues(actualValue, rule.value, operator);
      condition = `cvssScore ${operator} ${rule.value}`;
      break;

    case RuleType.CWE_CHECK:
      actualValue = vulnerability.cwe || [];
      if (operator === RuleOperator.IN || operator === RuleOperator.NOT_IN) {
        const ruleValues = Array.isArray(rule.value)
          ? rule.value
          : [rule.value];
        const hasMatch = (actualValue as string[]).some(
          (cwe) =>
            ruleValues.includes(cwe) ||
            ruleValues.includes(cwe.replace('CWE-', '')),
        );
        matches = operator === RuleOperator.IN ? hasMatch : !hasMatch;
      }
      condition = `cwe ${operator} ${JSON.stringify(rule.value)}`;
      break;

    case RuleType.OWASP_CATEGORY:
      actualValue = vulnerability.owaspCategory;
      matches = compareValues(actualValue, rule.value, operator);
      condition = `owaspCategory ${operator} ${rule.value}`;
      break;

    case RuleType.SCANNER_TYPE:
      actualValue = vulnerability.scannerType?.toUpperCase();
      matches = compareValues(actualValue, rule.value, operator);
      condition = `scannerType ${operator} ${rule.value}`;
      break;

    case RuleType.IS_NEW_VULNERABILITY:
      actualValue = vulnerability.isNew ?? false;
      matches = actualValue === rule.value;
      condition = `isNew ${operator} ${rule.value}`;
      break;

    case RuleType.VULNERABILITY_AGE_DAYS:
      if (vulnerability.createdAt) {
        const ageMs = Date.now() - vulnerability.createdAt;
        actualValue = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        matches = compareValues(actualValue, rule.value, operator);
      }
      condition = `ageDays ${operator} ${rule.value}`;
      break;

    case RuleType.BRANCH:
      actualValue = scanContext.branch || '';
      if (operator === RuleOperator.IN || operator === RuleOperator.NOT_IN) {
        const patterns = Array.isArray(rule.value) ? rule.value : [rule.value];
        const branchMatches = actualValue
          ? patterns.some((pattern) =>
              picomatch.isMatch(actualValue as string, pattern as string),
            )
          : false;
        matches = operator === RuleOperator.IN ? branchMatches : !branchMatches;
      } else if (
        operator === RuleOperator.EQUALS ||
        operator === RuleOperator.NOT_EQUALS
      ) {
        const pattern = rule.value as string;
        const branchMatches = actualValue
          ? picomatch.isMatch(actualValue as string, pattern)
          : false;
        matches =
          operator === RuleOperator.EQUALS ? branchMatches : !branchMatches;
      }
      condition = `branch ${operator} ${JSON.stringify(rule.value)}`;
      break;
  }

  return {
    matches,
    condition,
    matchedValues: matches
      ? [{ field: rule.type, expected: rule.value, actual: actualValue }]
      : [],
  };
}

/**
 * Evaluate a rule against a vulnerability (handles composite rules)
 */
function evaluateRule(
  rule: PolicyRule,
  vulnerability: VulnerabilityData,
  scanContext: ScanContext,
): {
  matches: boolean;
  condition: string;
  matchedValues: Record<string, unknown>[];
} {
  // Handle composite rules
  if (rule.type === RuleType.COMPOSITE_AND) {
    const results = (rule.criteria || []).map((c) =>
      evaluateRule(c, vulnerability, scanContext),
    );
    const allMatch = results.every((r) => r.matches);
    return {
      matches: allMatch,
      condition: `All of: ${results.map((r) => r.condition).join(', ')}`,
      matchedValues: results.flatMap((r) => r.matchedValues),
    };
  }

  if (rule.type === RuleType.COMPOSITE_OR) {
    const results = (rule.criteria || []).map((c) =>
      evaluateRule(c, vulnerability, scanContext),
    );
    const anyMatch = results.some((r) => r.matches);
    return {
      matches: anyMatch,
      condition: `Any of: ${results.map((r) => r.condition).join(', ')}`,
      matchedValues: results
        .filter((r) => r.matches)
        .flatMap((r) => r.matchedValues),
    };
  }

  return evaluateSimpleRule(rule, vulnerability, scanContext);
}

/**
 * Check if a vulnerability is excluded by any exclusion pattern
 */
function isExcluded(
  vulnerability: VulnerabilityData,
  exclusions: PolicyExclusion[],
): boolean {
  for (const exclusion of exclusions) {
    // Check expiration
    if (exclusion.expirationDate) {
      const expDate = new Date(exclusion.expirationDate);
      if (expDate < new Date()) continue;
    }

    // Check file path pattern
    if (exclusion.pattern && vulnerability.filePath) {
      const isMatch = picomatch.isMatch(
        vulnerability.filePath,
        exclusion.pattern,
      );
      if (isMatch) return true;
    }

    // Check CWE exclusions
    if (exclusion.cweIds && vulnerability.cwe) {
      const hasExcludedCwe = vulnerability.cwe.some(
        (cwe) =>
          exclusion.cweIds!.includes(cwe) ||
          exclusion.cweIds!.includes(cwe.replace('CWE-', '')),
      );
      if (hasExcludedCwe) return true;
    }

    // Check OWASP category exclusions
    if (exclusion.owaspCategories && vulnerability.owaspCategory) {
      if (exclusion.owaspCategories.includes(vulnerability.owaspCategory)) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// UNIT TESTS
// ============================================================================

describe('PolicyEvaluationProcessor - Rule Evaluation', () => {
  const defaultScanContext: ScanContext = {
    scanId: 'scan-123',
    branch: 'main',
  };

  // ============================================================================
  // SEVERITY RULE TESTS
  // ============================================================================
  describe('RuleType.SEVERITY', () => {
    const createSeverityRule = (
      operator: RuleOperator,
      value: string | string[],
      action: ViolationAction = ViolationAction.BLOCK,
    ): PolicyRule => ({
      id: 'rule-severity-1',
      name: 'Severity Check',
      isEnabled: true,
      action,
      type: RuleType.SEVERITY,
      operator,
      value,
    });

    const createVulnerability = (severity: string): VulnerabilityData => ({
      id: 'vuln-1',
      name: 'Test Vulnerability',
      severity,
      scannerType: 'SAST',
    });

    describe('EQUALS operator', () => {
      it('should match when severity equals the expected value', () => {
        const rule = createSeverityRule(RuleOperator.EQUALS, 'CRITICAL');
        const vuln = createVulnerability('CRITICAL');
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should match case-insensitively', () => {
        const rule = createSeverityRule(RuleOperator.EQUALS, 'CRITICAL');
        const vuln = createVulnerability('critical');
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when severity differs', () => {
        const rule = createSeverityRule(RuleOperator.EQUALS, 'CRITICAL');
        const vuln = createVulnerability('HIGH');
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });

    describe('NOT_EQUALS operator', () => {
      it('should match when severity differs', () => {
        const rule = createSeverityRule(RuleOperator.NOT_EQUALS, 'LOW');
        const vuln = createVulnerability('HIGH');
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when severity equals', () => {
        const rule = createSeverityRule(RuleOperator.NOT_EQUALS, 'HIGH');
        const vuln = createVulnerability('high');
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });

    describe('IN operator', () => {
      it('should match when severity is in the list', () => {
        const rule = createSeverityRule(RuleOperator.IN, ['CRITICAL', 'HIGH']);
        const vuln = createVulnerability('HIGH');
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when severity is not in the list', () => {
        const rule = createSeverityRule(RuleOperator.IN, ['CRITICAL', 'HIGH']);
        const vuln = createVulnerability('MEDIUM');
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });

    describe('NOT_IN operator', () => {
      it('should match when severity is not in the list', () => {
        const rule = createSeverityRule(RuleOperator.NOT_IN, ['LOW', 'INFO']);
        const vuln = createVulnerability('CRITICAL');
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when severity is in the list', () => {
        const rule = createSeverityRule(RuleOperator.NOT_IN, ['LOW', 'INFO']);
        const vuln = createVulnerability('LOW');
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });
  });

  // ============================================================================
  // CVSS_SCORE RULE TESTS
  // ============================================================================
  describe('RuleType.CVSS_SCORE', () => {
    const createCvssRule = (
      operator: RuleOperator,
      value: number,
      action: ViolationAction = ViolationAction.BLOCK,
    ): PolicyRule => ({
      id: 'rule-cvss-1',
      name: 'CVSS Score Check',
      isEnabled: true,
      action,
      type: RuleType.CVSS_SCORE,
      operator,
      value,
    });

    const createVulnerability = (
      cvssScore: number | undefined,
    ): VulnerabilityData => ({
      id: 'vuln-1',
      name: 'Test Vulnerability',
      severity: 'HIGH',
      cvssScore,
      scannerType: 'SAST',
    });

    describe('GTE operator', () => {
      it('should match when cvssScore >= threshold', () => {
        const rule = createCvssRule(RuleOperator.GTE, 7.0);
        const vuln = createVulnerability(8.5);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should match when cvssScore equals threshold', () => {
        const rule = createCvssRule(RuleOperator.GTE, 7.0);
        const vuln = createVulnerability(7.0);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when cvssScore < threshold', () => {
        const rule = createCvssRule(RuleOperator.GTE, 7.0);
        const vuln = createVulnerability(6.9);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });

      it('should treat undefined cvssScore as 0', () => {
        const rule = createCvssRule(RuleOperator.GTE, 7.0);
        const vuln = createVulnerability(undefined);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });

    describe('GT operator', () => {
      it('should match when cvssScore > threshold', () => {
        const rule = createCvssRule(RuleOperator.GT, 7.0);
        const vuln = createVulnerability(7.1);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when cvssScore equals threshold', () => {
        const rule = createCvssRule(RuleOperator.GT, 7.0);
        const vuln = createVulnerability(7.0);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });

    describe('LTE operator', () => {
      it('should match when cvssScore <= threshold', () => {
        const rule = createCvssRule(RuleOperator.LTE, 4.0);
        const vuln = createVulnerability(3.5);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should match when cvssScore equals threshold', () => {
        const rule = createCvssRule(RuleOperator.LTE, 4.0);
        const vuln = createVulnerability(4.0);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when cvssScore > threshold', () => {
        const rule = createCvssRule(RuleOperator.LTE, 4.0);
        const vuln = createVulnerability(4.1);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });

    describe('LT operator', () => {
      it('should match when cvssScore < threshold', () => {
        const rule = createCvssRule(RuleOperator.LT, 4.0);
        const vuln = createVulnerability(3.9);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when cvssScore equals threshold', () => {
        const rule = createCvssRule(RuleOperator.LT, 4.0);
        const vuln = createVulnerability(4.0);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });

    describe('EQUALS operator', () => {
      it('should match when cvssScore exactly equals value', () => {
        const rule = createCvssRule(RuleOperator.EQUALS, 5.0);
        const vuln = createVulnerability(5.0);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when cvssScore differs', () => {
        const rule = createCvssRule(RuleOperator.EQUALS, 5.0);
        const vuln = createVulnerability(5.1);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });
  });

  // ============================================================================
  // CWE_CHECK RULE TESTS
  // ============================================================================
  describe('RuleType.CWE_CHECK', () => {
    const createCweRule = (
      operator: RuleOperator,
      value: string | string[],
    ): PolicyRule => ({
      id: 'rule-cwe-1',
      name: 'CWE Check',
      isEnabled: true,
      action: ViolationAction.BLOCK,
      type: RuleType.CWE_CHECK,
      operator,
      value,
    });

    const createVulnerability = (
      cwe: string[] | undefined,
    ): VulnerabilityData => ({
      id: 'vuln-1',
      name: 'Test Vulnerability',
      severity: 'HIGH',
      cwe,
      scannerType: 'SAST',
    });

    describe('IN operator', () => {
      it('should match when vulnerability has CWE in the list', () => {
        const rule = createCweRule(RuleOperator.IN, ['CWE-79', 'CWE-89']);
        const vuln = createVulnerability(['CWE-79']);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should match without CWE- prefix', () => {
        const rule = createCweRule(RuleOperator.IN, ['79', '89']);
        const vuln = createVulnerability(['CWE-79']);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should match when any CWE matches', () => {
        const rule = createCweRule(RuleOperator.IN, ['CWE-79']);
        const vuln = createVulnerability(['CWE-22', 'CWE-79', 'CWE-89']);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when no CWE matches', () => {
        const rule = createCweRule(RuleOperator.IN, ['CWE-79', 'CWE-89']);
        const vuln = createVulnerability(['CWE-22', 'CWE-78']);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });

      it('should not match when vulnerability has no CWE', () => {
        const rule = createCweRule(RuleOperator.IN, ['CWE-79']);
        const vuln = createVulnerability(undefined);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });

    describe('NOT_IN operator', () => {
      it('should match when vulnerability has no excluded CWE', () => {
        const rule = createCweRule(RuleOperator.NOT_IN, ['CWE-79', 'CWE-89']);
        const vuln = createVulnerability(['CWE-22']);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when vulnerability has excluded CWE', () => {
        const rule = createCweRule(RuleOperator.NOT_IN, ['CWE-79']);
        const vuln = createVulnerability(['CWE-79']);
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });
  });

  // ============================================================================
  // OWASP_CATEGORY RULE TESTS
  // ============================================================================
  describe('RuleType.OWASP_CATEGORY', () => {
    const createOwaspRule = (
      operator: RuleOperator,
      value: string | string[],
    ): PolicyRule => ({
      id: 'rule-owasp-1',
      name: 'OWASP Category Check',
      isEnabled: true,
      action: ViolationAction.WARN,
      type: RuleType.OWASP_CATEGORY,
      operator,
      value,
    });

    const createVulnerability = (
      owaspCategory?: string,
    ): VulnerabilityData => ({
      id: 'vuln-1',
      name: 'Test Vulnerability',
      severity: 'HIGH',
      owaspCategory,
      scannerType: 'SAST',
    });

    it('should match when OWASP category equals', () => {
      const rule = createOwaspRule(RuleOperator.EQUALS, 'A01:2021');
      const vuln = createVulnerability('A01:2021');
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });

    it('should not match when OWASP category differs', () => {
      const rule = createOwaspRule(RuleOperator.EQUALS, 'A01:2021');
      const vuln = createVulnerability('A03:2021');
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(false);
    });

    it('should match with IN operator', () => {
      const rule = createOwaspRule(RuleOperator.IN, [
        'A01:2021',
        'A02:2021',
        'A03:2021',
      ]);
      const vuln = createVulnerability('A02:2021');
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });
  });

  // ============================================================================
  // SCANNER_TYPE RULE TESTS
  // ============================================================================
  describe('RuleType.SCANNER_TYPE', () => {
    const createScannerRule = (
      operator: RuleOperator,
      value: string | string[],
    ): PolicyRule => ({
      id: 'rule-scanner-1',
      name: 'Scanner Type Check',
      isEnabled: true,
      action: ViolationAction.BLOCK,
      type: RuleType.SCANNER_TYPE,
      operator,
      value,
    });

    const createVulnerability = (scannerType: string): VulnerabilityData => ({
      id: 'vuln-1',
      name: 'Test Vulnerability',
      severity: 'HIGH',
      scannerType,
    });

    it('should match when scanner type equals', () => {
      const rule = createScannerRule(RuleOperator.EQUALS, 'SAST');
      const vuln = createVulnerability('SAST');
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });

    it('should match case-insensitively', () => {
      const rule = createScannerRule(RuleOperator.EQUALS, 'SAST');
      const vuln = createVulnerability('sast');
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });

    it('should match with IN operator', () => {
      const rule = createScannerRule(RuleOperator.IN, ['SAST', 'SCA']);
      const vuln = createVulnerability('SCA');
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });

    it('should match with NOT_IN operator', () => {
      const rule = createScannerRule(RuleOperator.NOT_IN, ['SECRET']);
      const vuln = createVulnerability('SAST');
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });
  });

  // ============================================================================
  // IS_NEW_VULNERABILITY RULE TESTS
  // ============================================================================
  describe('RuleType.IS_NEW_VULNERABILITY', () => {
    const createNewVulnRule = (value: boolean): PolicyRule => ({
      id: 'rule-new-1',
      name: 'New Vulnerability Check',
      isEnabled: true,
      action: ViolationAction.BLOCK,
      type: RuleType.IS_NEW_VULNERABILITY,
      operator: RuleOperator.EQUALS,
      value,
    });

    const createVulnerability = (isNew?: boolean): VulnerabilityData => ({
      id: 'vuln-1',
      name: 'Test Vulnerability',
      severity: 'HIGH',
      isNew,
      scannerType: 'SAST',
    });

    it('should match when isNew equals true', () => {
      const rule = createNewVulnRule(true);
      const vuln = createVulnerability(true);
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });

    it('should not match when isNew is false', () => {
      const rule = createNewVulnRule(true);
      const vuln = createVulnerability(false);
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(false);
    });

    it('should treat undefined isNew as false', () => {
      const rule = createNewVulnRule(false);
      const vuln = createVulnerability(undefined);
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });
  });

  // ============================================================================
  // VULNERABILITY_AGE_DAYS RULE TESTS
  // ============================================================================
  describe('RuleType.VULNERABILITY_AGE_DAYS', () => {
    const createAgeRule = (
      operator: RuleOperator,
      days: number,
    ): PolicyRule => ({
      id: 'rule-age-1',
      name: 'Vulnerability Age Check',
      isEnabled: true,
      action: ViolationAction.WARN,
      type: RuleType.VULNERABILITY_AGE_DAYS,
      operator,
      value: days,
    });

    const createVulnerability = (
      daysOld: number | null,
    ): VulnerabilityData => ({
      id: 'vuln-1',
      name: 'Test Vulnerability',
      severity: 'HIGH',
      createdAt:
        daysOld !== null
          ? Date.now() - daysOld * 24 * 60 * 60 * 1000
          : undefined,
      scannerType: 'SAST',
    });

    it('should match when age >= threshold with GTE operator', () => {
      const rule = createAgeRule(RuleOperator.GTE, 30);
      const vuln = createVulnerability(35);
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });

    it('should not match when age < threshold with GTE operator', () => {
      const rule = createAgeRule(RuleOperator.GTE, 30);
      const vuln = createVulnerability(25);
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(false);
    });

    it('should match when age > threshold with GT operator', () => {
      const rule = createAgeRule(RuleOperator.GT, 30);
      const vuln = createVulnerability(31);
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });

    it('should not match when createdAt is undefined', () => {
      const rule = createAgeRule(RuleOperator.GTE, 30);
      const vuln = createVulnerability(null);
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(false);
    });
  });

  // ============================================================================
  // BRANCH RULE TESTS
  // ============================================================================
  describe('RuleType.BRANCH', () => {
    const createBranchRule = (
      operator: RuleOperator,
      value: string | string[],
    ): PolicyRule => ({
      id: 'rule-branch-1',
      name: 'Branch Check',
      isEnabled: true,
      action: ViolationAction.BLOCK,
      type: RuleType.BRANCH,
      operator,
      value,
    });

    const createVulnerability = (): VulnerabilityData => ({
      id: 'vuln-1',
      name: 'Test Vulnerability',
      severity: 'HIGH',
      scannerType: 'SAST',
    });

    describe('EQUALS operator with glob patterns', () => {
      it('should match exact branch name', () => {
        const rule = createBranchRule(RuleOperator.EQUALS, 'main');
        const vuln = createVulnerability();
        const result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: 'main',
        });
        expect(result.matches).toBe(true);
      });

      it('should match with wildcard pattern', () => {
        const rule = createBranchRule(RuleOperator.EQUALS, 'release/*');
        const vuln = createVulnerability();
        const result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: 'release/v1.0',
        });
        expect(result.matches).toBe(true);
      });

      it('should match with double wildcard pattern', () => {
        const rule = createBranchRule(RuleOperator.EQUALS, 'feature/**');
        const vuln = createVulnerability();
        const result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: 'feature/auth/login',
        });
        expect(result.matches).toBe(true);
      });

      it('should not match when pattern does not match', () => {
        const rule = createBranchRule(RuleOperator.EQUALS, 'main');
        const vuln = createVulnerability();
        const result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: 'develop',
        });
        expect(result.matches).toBe(false);
      });

      it('should not match when branch is empty', () => {
        const rule = createBranchRule(RuleOperator.EQUALS, 'main');
        const vuln = createVulnerability();
        const result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: '',
        });
        expect(result.matches).toBe(false);
      });
    });

    describe('NOT_EQUALS operator', () => {
      it('should match when branch differs', () => {
        const rule = createBranchRule(RuleOperator.NOT_EQUALS, 'main');
        const vuln = createVulnerability();
        const result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: 'develop',
        });
        expect(result.matches).toBe(true);
      });

      it('should not match when branch equals', () => {
        const rule = createBranchRule(RuleOperator.NOT_EQUALS, 'main');
        const vuln = createVulnerability();
        const result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: 'main',
        });
        expect(result.matches).toBe(false);
      });
    });

    describe('IN operator', () => {
      it('should match when branch is in the list', () => {
        const rule = createBranchRule(RuleOperator.IN, [
          'main',
          'develop',
          'release/*',
        ]);
        const vuln = createVulnerability();
        const result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: 'release/v2.0',
        });
        expect(result.matches).toBe(true);
      });

      it('should not match when branch is not in the list', () => {
        const rule = createBranchRule(RuleOperator.IN, ['main', 'develop']);
        const vuln = createVulnerability();
        const result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: 'feature/new',
        });
        expect(result.matches).toBe(false);
      });
    });

    describe('NOT_IN operator', () => {
      it('should match when branch is not in the excluded list', () => {
        const rule = createBranchRule(RuleOperator.NOT_IN, [
          'feature/*',
          'bugfix/*',
        ]);
        const vuln = createVulnerability();
        const result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: 'main',
        });
        expect(result.matches).toBe(true);
      });

      it('should not match when branch is in the excluded list', () => {
        const rule = createBranchRule(RuleOperator.NOT_IN, ['feature/*']);
        const vuln = createVulnerability();
        const result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: 'feature/login',
        });
        expect(result.matches).toBe(false);
      });
    });
  });

  // ============================================================================
  // COMPOSITE RULES TESTS
  // ============================================================================
  describe('Composite Rules', () => {
    const createVulnerability = (
      overrides: Partial<VulnerabilityData> = {},
    ): VulnerabilityData => ({
      id: 'vuln-1',
      name: 'Test Vulnerability',
      severity: 'HIGH',
      cvssScore: 8.5,
      cwe: ['CWE-79'],
      scannerType: 'SAST',
      ...overrides,
    });

    describe('COMPOSITE_AND', () => {
      it('should match when ALL criteria match', () => {
        const rule: PolicyRule = {
          id: 'rule-composite-and-1',
          name: 'High Severity SAST Vulnerabilities',
          isEnabled: true,
          action: ViolationAction.BLOCK,
          type: RuleType.COMPOSITE_AND,
          criteria: [
            {
              id: 'sub-1',
              name: 'Severity Check',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.SEVERITY,
              operator: RuleOperator.IN,
              value: ['CRITICAL', 'HIGH'],
            },
            {
              id: 'sub-2',
              name: 'Scanner Check',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.SCANNER_TYPE,
              operator: RuleOperator.EQUALS,
              value: 'SAST',
            },
          ],
        };

        const vuln = createVulnerability({
          severity: 'HIGH',
          scannerType: 'SAST',
        });
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when ONE criterion fails', () => {
        const rule: PolicyRule = {
          id: 'rule-composite-and-1',
          name: 'High Severity SAST Vulnerabilities',
          isEnabled: true,
          action: ViolationAction.BLOCK,
          type: RuleType.COMPOSITE_AND,
          criteria: [
            {
              id: 'sub-1',
              name: 'Severity Check',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.SEVERITY,
              operator: RuleOperator.EQUALS,
              value: 'CRITICAL',
            },
            {
              id: 'sub-2',
              name: 'Scanner Check',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.SCANNER_TYPE,
              operator: RuleOperator.EQUALS,
              value: 'SAST',
            },
          ],
        };

        const vuln = createVulnerability({
          severity: 'HIGH',
          scannerType: 'SAST',
        }); // HIGH, not CRITICAL
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });

      it('should not match when ALL criteria fail', () => {
        const rule: PolicyRule = {
          id: 'rule-composite-and-1',
          name: 'Test Rule',
          isEnabled: true,
          action: ViolationAction.BLOCK,
          type: RuleType.COMPOSITE_AND,
          criteria: [
            {
              id: 'sub-1',
              name: 'Severity Check',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.SEVERITY,
              operator: RuleOperator.EQUALS,
              value: 'LOW',
            },
            {
              id: 'sub-2',
              name: 'Scanner Check',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.SCANNER_TYPE,
              operator: RuleOperator.EQUALS,
              value: 'IAC',
            },
          ],
        };

        const vuln = createVulnerability({
          severity: 'HIGH',
          scannerType: 'SAST',
        });
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });

    describe('COMPOSITE_OR', () => {
      it('should match when ANY criterion matches', () => {
        const rule: PolicyRule = {
          id: 'rule-composite-or-1',
          name: 'Critical or High CVSS',
          isEnabled: true,
          action: ViolationAction.BLOCK,
          type: RuleType.COMPOSITE_OR,
          criteria: [
            {
              id: 'sub-1',
              name: 'Critical Severity',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.SEVERITY,
              operator: RuleOperator.EQUALS,
              value: 'CRITICAL',
            },
            {
              id: 'sub-2',
              name: 'High CVSS',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.CVSS_SCORE,
              operator: RuleOperator.GTE,
              value: 9.0,
            },
          ],
        };

        const vuln = createVulnerability({
          severity: 'CRITICAL',
          cvssScore: 7.0,
        });
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should match when ALL criteria match', () => {
        const rule: PolicyRule = {
          id: 'rule-composite-or-1',
          name: 'Test Rule',
          isEnabled: true,
          action: ViolationAction.BLOCK,
          type: RuleType.COMPOSITE_OR,
          criteria: [
            {
              id: 'sub-1',
              name: 'Critical Severity',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.SEVERITY,
              operator: RuleOperator.EQUALS,
              value: 'CRITICAL',
            },
            {
              id: 'sub-2',
              name: 'High CVSS',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.CVSS_SCORE,
              operator: RuleOperator.GTE,
              value: 9.0,
            },
          ],
        };

        const vuln = createVulnerability({
          severity: 'CRITICAL',
          cvssScore: 9.5,
        });
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);
      });

      it('should not match when NO criteria match', () => {
        const rule: PolicyRule = {
          id: 'rule-composite-or-1',
          name: 'Test Rule',
          isEnabled: true,
          action: ViolationAction.BLOCK,
          type: RuleType.COMPOSITE_OR,
          criteria: [
            {
              id: 'sub-1',
              name: 'Critical Severity',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.SEVERITY,
              operator: RuleOperator.EQUALS,
              value: 'CRITICAL',
            },
            {
              id: 'sub-2',
              name: 'High CVSS',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.CVSS_SCORE,
              operator: RuleOperator.GTE,
              value: 9.0,
            },
          ],
        };

        const vuln = createVulnerability({ severity: 'LOW', cvssScore: 3.0 });
        const result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });
    });

    describe('Nested Composite Rules', () => {
      it('should evaluate deeply nested AND/OR rules', () => {
        // Rule: (CRITICAL severity AND SAST scanner) OR (CVSS >= 9.0)
        const rule: PolicyRule = {
          id: 'rule-nested-1',
          name: 'Complex Nested Rule',
          isEnabled: true,
          action: ViolationAction.BLOCK,
          type: RuleType.COMPOSITE_OR,
          criteria: [
            {
              id: 'and-group',
              name: 'Critical SAST',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.COMPOSITE_AND,
              criteria: [
                {
                  id: 'sub-1',
                  name: 'Critical Severity',
                  isEnabled: true,
                  action: ViolationAction.BLOCK,
                  type: RuleType.SEVERITY,
                  operator: RuleOperator.EQUALS,
                  value: 'CRITICAL',
                },
                {
                  id: 'sub-2',
                  name: 'SAST Scanner',
                  isEnabled: true,
                  action: ViolationAction.BLOCK,
                  type: RuleType.SCANNER_TYPE,
                  operator: RuleOperator.EQUALS,
                  value: 'SAST',
                },
              ],
            },
            {
              id: 'cvss-rule',
              name: 'Very High CVSS',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.CVSS_SCORE,
              operator: RuleOperator.GTE,
              value: 9.0,
            },
          ],
        };

        // Should match: CRITICAL + SAST
        let vuln = createVulnerability({
          severity: 'CRITICAL',
          scannerType: 'SAST',
          cvssScore: 5.0,
        });
        let result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);

        // Should match: CVSS >= 9.0
        vuln = createVulnerability({
          severity: 'HIGH',
          scannerType: 'SCA',
          cvssScore: 9.5,
        });
        result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(true);

        // Should not match: HIGH + SAST + CVSS 5.0
        vuln = createVulnerability({
          severity: 'HIGH',
          scannerType: 'SAST',
          cvssScore: 5.0,
        });
        result = evaluateRule(rule, vuln, defaultScanContext);
        expect(result.matches).toBe(false);
      });

      it('should evaluate triple-nested rules', () => {
        // Rule: ((CRITICAL AND main branch) OR (HIGH AND release/*)) AND SAST
        const rule: PolicyRule = {
          id: 'rule-triple-nested',
          name: 'Triple Nested Rule',
          isEnabled: true,
          action: ViolationAction.BLOCK,
          type: RuleType.COMPOSITE_AND,
          criteria: [
            {
              id: 'severity-branch-group',
              name: 'Severity + Branch conditions',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.COMPOSITE_OR,
              criteria: [
                {
                  id: 'critical-main',
                  name: 'Critical on main',
                  isEnabled: true,
                  action: ViolationAction.BLOCK,
                  type: RuleType.COMPOSITE_AND,
                  criteria: [
                    {
                      id: 'critical',
                      name: 'Critical',
                      isEnabled: true,
                      action: ViolationAction.BLOCK,
                      type: RuleType.SEVERITY,
                      operator: RuleOperator.EQUALS,
                      value: 'CRITICAL',
                    },
                    {
                      id: 'main-branch',
                      name: 'Main Branch',
                      isEnabled: true,
                      action: ViolationAction.BLOCK,
                      type: RuleType.BRANCH,
                      operator: RuleOperator.EQUALS,
                      value: 'main',
                    },
                  ],
                },
                {
                  id: 'high-release',
                  name: 'High on release',
                  isEnabled: true,
                  action: ViolationAction.BLOCK,
                  type: RuleType.COMPOSITE_AND,
                  criteria: [
                    {
                      id: 'high',
                      name: 'High',
                      isEnabled: true,
                      action: ViolationAction.BLOCK,
                      type: RuleType.SEVERITY,
                      operator: RuleOperator.EQUALS,
                      value: 'HIGH',
                    },
                    {
                      id: 'release-branch',
                      name: 'Release Branch',
                      isEnabled: true,
                      action: ViolationAction.BLOCK,
                      type: RuleType.BRANCH,
                      operator: RuleOperator.EQUALS,
                      value: 'release/*',
                    },
                  ],
                },
              ],
            },
            {
              id: 'sast-scanner',
              name: 'SAST Scanner',
              isEnabled: true,
              action: ViolationAction.BLOCK,
              type: RuleType.SCANNER_TYPE,
              operator: RuleOperator.EQUALS,
              value: 'SAST',
            },
          ],
        };

        const vuln = createVulnerability({
          severity: 'HIGH',
          scannerType: 'SAST',
        });

        // Should match: HIGH + release/v1.0 + SAST
        let result = evaluateRule(rule, vuln, {
          scanId: 'scan-1',
          branch: 'release/v1.0',
        });
        expect(result.matches).toBe(true);

        // Should not match: HIGH + main + SAST (not CRITICAL on main)
        result = evaluateRule(rule, vuln, { scanId: 'scan-1', branch: 'main' });
        expect(result.matches).toBe(false);

        // Should match: CRITICAL + main + SAST
        const criticalVuln = createVulnerability({
          severity: 'CRITICAL',
          scannerType: 'SAST',
        });
        result = evaluateRule(rule, criticalVuln, {
          scanId: 'scan-1',
          branch: 'main',
        });
        expect(result.matches).toBe(true);
      });
    });
  });

  // ============================================================================
  // EXCLUSION TESTS
  // ============================================================================
  describe('Exclusions', () => {
    describe('File Path Pattern Exclusions', () => {
      it('should exclude by exact file path', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: 'test/helper.ts', reason: 'Test file' },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'Test Vuln',
          severity: 'HIGH',
          scannerType: 'SAST',
          filePath: 'test/helper.ts',
        };
        expect(isExcluded(vuln, exclusions)).toBe(true);
      });

      it('should exclude by glob pattern', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: 'test/**', reason: 'Test files' },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'Test Vuln',
          severity: 'HIGH',
          scannerType: 'SAST',
          filePath: 'test/unit/helper.ts',
        };
        expect(isExcluded(vuln, exclusions)).toBe(true);
      });

      it('should exclude by wildcard extension', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: '**/*.test.ts', reason: 'Test files' },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'Test Vuln',
          severity: 'HIGH',
          scannerType: 'SAST',
          filePath: 'src/modules/auth/auth.test.ts',
        };
        expect(isExcluded(vuln, exclusions)).toBe(true);
      });

      it('should not exclude when pattern does not match', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: 'test/**', reason: 'Test files' },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'Test Vuln',
          severity: 'HIGH',
          scannerType: 'SAST',
          filePath: 'src/main.ts',
        };
        expect(isExcluded(vuln, exclusions)).toBe(false);
      });

      it('should not exclude when vulnerability has no file path', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: '**/*', reason: 'All files' },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'Test Vuln',
          severity: 'HIGH',
          scannerType: 'SCA',
          filePath: undefined,
        };
        expect(isExcluded(vuln, exclusions)).toBe(false);
      });
    });

    describe('CWE Exclusions', () => {
      it('should exclude by CWE ID with prefix', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: '', reason: 'Known CWE', cweIds: ['CWE-79'] },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'XSS Vulnerability',
          severity: 'HIGH',
          scannerType: 'SAST',
          cwe: ['CWE-79'],
        };
        expect(isExcluded(vuln, exclusions)).toBe(true);
      });

      it('should exclude by CWE ID without prefix', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: '', reason: 'Known CWE', cweIds: ['79'] },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'XSS Vulnerability',
          severity: 'HIGH',
          scannerType: 'SAST',
          cwe: ['CWE-79'],
        };
        expect(isExcluded(vuln, exclusions)).toBe(true);
      });

      it('should exclude when any CWE matches', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: '', reason: 'Known CWE', cweIds: ['CWE-89'] },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'SQL Injection',
          severity: 'HIGH',
          scannerType: 'SAST',
          cwe: ['CWE-79', 'CWE-89', 'CWE-22'],
        };
        expect(isExcluded(vuln, exclusions)).toBe(true);
      });

      it('should not exclude when CWE does not match', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: '', reason: 'Known CWE', cweIds: ['CWE-79'] },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'SQL Injection',
          severity: 'HIGH',
          scannerType: 'SAST',
          cwe: ['CWE-89'],
        };
        expect(isExcluded(vuln, exclusions)).toBe(false);
      });
    });

    describe('OWASP Category Exclusions', () => {
      it('should exclude by OWASP category', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: '', reason: 'Known OWASP', owaspCategories: ['A01:2021'] },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'Test Vuln',
          severity: 'HIGH',
          scannerType: 'SAST',
          owaspCategory: 'A01:2021',
        };
        expect(isExcluded(vuln, exclusions)).toBe(true);
      });

      it('should not exclude when OWASP category does not match', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: '', reason: 'Known OWASP', owaspCategories: ['A01:2021'] },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'Test Vuln',
          severity: 'HIGH',
          scannerType: 'SAST',
          owaspCategory: 'A03:2021',
        };
        expect(isExcluded(vuln, exclusions)).toBe(false);
      });
    });

    describe('Expiration Date', () => {
      it('should not exclude when exclusion has expired', () => {
        const yesterday = new Date(
          Date.now() - 24 * 60 * 60 * 1000,
        ).toISOString();
        const exclusions: PolicyExclusion[] = [
          {
            pattern: 'test/**',
            reason: 'Temporary',
            expirationDate: yesterday,
          },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'Test Vuln',
          severity: 'HIGH',
          scannerType: 'SAST',
          filePath: 'test/helper.ts',
        };
        expect(isExcluded(vuln, exclusions)).toBe(false);
      });

      it('should exclude when exclusion has not expired', () => {
        const tomorrow = new Date(
          Date.now() + 24 * 60 * 60 * 1000,
        ).toISOString();
        const exclusions: PolicyExclusion[] = [
          { pattern: 'test/**', reason: 'Temporary', expirationDate: tomorrow },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'Test Vuln',
          severity: 'HIGH',
          scannerType: 'SAST',
          filePath: 'test/helper.ts',
        };
        expect(isExcluded(vuln, exclusions)).toBe(true);
      });
    });

    describe('Multiple Exclusions', () => {
      it('should exclude if any exclusion matches', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: 'test/**', reason: 'Test files' },
          { pattern: '', reason: 'Known CWE', cweIds: ['CWE-79'] },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'XSS',
          severity: 'HIGH',
          scannerType: 'SAST',
          filePath: 'src/main.ts',
          cwe: ['CWE-79'],
        };
        expect(isExcluded(vuln, exclusions)).toBe(true);
      });

      it('should not exclude if no exclusion matches', () => {
        const exclusions: PolicyExclusion[] = [
          { pattern: 'test/**', reason: 'Test files' },
          { pattern: '', reason: 'Known CWE', cweIds: ['CWE-79'] },
        ];
        const vuln: VulnerabilityData = {
          id: 'vuln-1',
          name: 'SQL Injection',
          severity: 'HIGH',
          scannerType: 'SAST',
          filePath: 'src/main.ts',
          cwe: ['CWE-89'],
        };
        expect(isExcluded(vuln, exclusions)).toBe(false);
      });
    });
  });

  // ============================================================================
  // DISABLED RULES TESTS
  // ============================================================================
  describe('Disabled Rules', () => {
    it('should still evaluate disabled rules (filtering is done at processor level)', () => {
      const rule: PolicyRule = {
        id: 'rule-disabled-1',
        name: 'Disabled Rule',
        isEnabled: false,
        action: ViolationAction.BLOCK,
        type: RuleType.SEVERITY,
        operator: RuleOperator.EQUALS,
        value: 'CRITICAL',
      };

      const vuln: VulnerabilityData = {
        id: 'vuln-1',
        name: 'Test Vuln',
        severity: 'CRITICAL',
        scannerType: 'SAST',
      };

      // evaluateRule doesn't check isEnabled - it's checked at processor level
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================
  describe('Edge Cases', () => {
    it('should handle empty criteria in composite AND', () => {
      const rule: PolicyRule = {
        id: 'rule-empty-and',
        name: 'Empty AND',
        isEnabled: true,
        action: ViolationAction.BLOCK,
        type: RuleType.COMPOSITE_AND,
        criteria: [],
      };

      const vuln: VulnerabilityData = {
        id: 'vuln-1',
        name: 'Test Vuln',
        severity: 'HIGH',
        scannerType: 'SAST',
      };

      // Empty AND should match (all of nothing is true)
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });

    it('should handle empty criteria in composite OR', () => {
      const rule: PolicyRule = {
        id: 'rule-empty-or',
        name: 'Empty OR',
        isEnabled: true,
        action: ViolationAction.BLOCK,
        type: RuleType.COMPOSITE_OR,
        criteria: [],
      };

      const vuln: VulnerabilityData = {
        id: 'vuln-1',
        name: 'Test Vuln',
        severity: 'HIGH',
        scannerType: 'SAST',
      };

      // Empty OR should not match (any of nothing is false)
      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(false);
    });

    it('should handle undefined operator (defaults to EQUALS)', () => {
      const rule: PolicyRule = {
        id: 'rule-no-operator',
        name: 'No Operator',
        isEnabled: true,
        action: ViolationAction.BLOCK,
        type: RuleType.SEVERITY,
        value: 'HIGH',
        // operator is undefined
      };

      const vuln: VulnerabilityData = {
        id: 'vuln-1',
        name: 'Test Vuln',
        severity: 'HIGH',
        scannerType: 'SAST',
      };

      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(true);
    });

    it('should handle null/undefined vulnerability fields gracefully', () => {
      const rule: PolicyRule = {
        id: 'rule-owasp',
        name: 'OWASP Check',
        isEnabled: true,
        action: ViolationAction.BLOCK,
        type: RuleType.OWASP_CATEGORY,
        operator: RuleOperator.EQUALS,
        value: 'A01:2021',
      };

      const vuln: VulnerabilityData = {
        id: 'vuln-1',
        name: 'Test Vuln',
        severity: 'HIGH',
        scannerType: 'SAST',
        owaspCategory: undefined,
      };

      const result = evaluateRule(rule, vuln, defaultScanContext);
      expect(result.matches).toBe(false);
    });
  });
});

// ============================================================================
// INTEGRATION-STYLE TESTS - Multiple Policies at Different Scopes
// ============================================================================
describe('PolicyEvaluation - Multi-Scope Policy Scenarios', () => {
  /**
   * Simulates the effective policy merging that happens in getEffectivePolicy()
   * and then evaluates vulnerabilities against all rules from all policies.
   */
  function evaluateVulnerabilitiesAgainstPolicies(
    vulnerabilities: VulnerabilityData[],
    allRules: PolicyRule[],
    exclusions: PolicyExclusion[],
    scanContext: ScanContext,
  ): {
    violations: Array<{
      ruleId: string;
      ruleName: string;
      action: ViolationAction;
      vulnerabilityId: string;
    }>;
    compliant: boolean;
    highestAction: ViolationAction | null;
  } {
    const violations: Array<{
      ruleId: string;
      ruleName: string;
      action: ViolationAction;
      vulnerabilityId: string;
    }> = [];
    let highestAction: ViolationAction | null = null;

    for (const vulnerability of vulnerabilities) {
      // Check exclusions
      if (isExcluded(vulnerability, exclusions)) {
        continue;
      }

      for (const rule of allRules) {
        if (!rule.isEnabled) continue;

        const result = evaluateRule(rule, vulnerability, scanContext);
        if (result.matches) {
          violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            action: rule.action,
            vulnerabilityId: vulnerability.id,
          });

          if (rule.action === ViolationAction.BLOCK) {
            highestAction = ViolationAction.BLOCK;
          } else if (highestAction !== ViolationAction.BLOCK) {
            highestAction = ViolationAction.WARN;
          }
        }
      }
    }

    return {
      violations,
      compliant: violations.length === 0,
      highestAction,
    };
  }

  describe('Organization + Team + Project Policy Inheritance', () => {
    // Organization-level policy: Block all CRITICAL vulnerabilities
    const orgPolicy: PolicyRule[] = [
      {
        id: 'org-rule-1',
        name: 'Block Critical (Org)',
        isEnabled: true,
        action: ViolationAction.BLOCK,
        type: RuleType.SEVERITY,
        operator: RuleOperator.EQUALS,
        value: 'CRITICAL',
      },
    ];

    // Team-level policy: Warn on HIGH SAST vulnerabilities
    const teamPolicy: PolicyRule[] = [
      {
        id: 'team-rule-1',
        name: 'Warn High SAST (Team)',
        isEnabled: true,
        action: ViolationAction.WARN,
        type: RuleType.COMPOSITE_AND,
        criteria: [
          {
            id: 'team-sub-1',
            name: 'High Severity',
            isEnabled: true,
            action: ViolationAction.WARN,
            type: RuleType.SEVERITY,
            operator: RuleOperator.EQUALS,
            value: 'HIGH',
          },
          {
            id: 'team-sub-2',
            name: 'SAST Scanner',
            isEnabled: true,
            action: ViolationAction.WARN,
            type: RuleType.SCANNER_TYPE,
            operator: RuleOperator.EQUALS,
            value: 'SAST',
          },
        ],
      },
    ];

    // Project-level policy: Block on main branch with CVSS >= 8
    const projectPolicy: PolicyRule[] = [
      {
        id: 'project-rule-1',
        name: 'Block High CVSS on Main (Project)',
        isEnabled: true,
        action: ViolationAction.BLOCK,
        type: RuleType.COMPOSITE_AND,
        criteria: [
          {
            id: 'project-sub-1',
            name: 'Main Branch',
            isEnabled: true,
            action: ViolationAction.BLOCK,
            type: RuleType.BRANCH,
            operator: RuleOperator.EQUALS,
            value: 'main',
          },
          {
            id: 'project-sub-2',
            name: 'High CVSS',
            isEnabled: true,
            action: ViolationAction.BLOCK,
            type: RuleType.CVSS_SCORE,
            operator: RuleOperator.GTE,
            value: 8.0,
          },
        ],
      },
    ];

    // Merged effective policy (all rules from all scopes)
    const allRules = [...orgPolicy, ...teamPolicy, ...projectPolicy];

    it('should trigger org-level block for CRITICAL vulnerability', () => {
      const vulns: VulnerabilityData[] = [
        {
          id: 'vuln-1',
          name: 'Critical RCE',
          severity: 'CRITICAL',
          cvssScore: 9.8,
          scannerType: 'SAST',
        },
      ];

      const result = evaluateVulnerabilitiesAgainstPolicies(
        vulns,
        allRules,
        [],
        { scanId: 'scan-1', branch: 'develop' },
      );

      expect(result.compliant).toBe(false);
      expect(result.highestAction).toBe(ViolationAction.BLOCK);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].ruleName).toBe('Block Critical (Org)');
    });

    it('should trigger team-level warn for HIGH SAST vulnerability', () => {
      const vulns: VulnerabilityData[] = [
        {
          id: 'vuln-1',
          name: 'High XSS',
          severity: 'HIGH',
          cvssScore: 6.5,
          scannerType: 'SAST',
        },
      ];

      const result = evaluateVulnerabilitiesAgainstPolicies(
        vulns,
        allRules,
        [],
        { scanId: 'scan-1', branch: 'develop' },
      );

      expect(result.compliant).toBe(false);
      expect(result.highestAction).toBe(ViolationAction.WARN);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].ruleName).toBe('Warn High SAST (Team)');
    });

    it('should trigger project-level block for HIGH CVSS on main', () => {
      const vulns: VulnerabilityData[] = [
        {
          id: 'vuln-1',
          name: 'Medium SQLi',
          severity: 'MEDIUM',
          cvssScore: 8.5,
          scannerType: 'SCA',
        },
      ];

      const result = evaluateVulnerabilitiesAgainstPolicies(
        vulns,
        allRules,
        [],
        { scanId: 'scan-1', branch: 'main' },
      );

      expect(result.compliant).toBe(false);
      expect(result.highestAction).toBe(ViolationAction.BLOCK);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].ruleName).toBe(
        'Block High CVSS on Main (Project)',
      );
    });

    it('should trigger multiple rules from different scopes', () => {
      const vulns: VulnerabilityData[] = [
        {
          id: 'vuln-1',
          name: 'Critical SAST Issue',
          severity: 'CRITICAL',
          cvssScore: 9.5,
          scannerType: 'SAST',
        },
      ];

      const result = evaluateVulnerabilitiesAgainstPolicies(
        vulns,
        allRules,
        [],
        { scanId: 'scan-1', branch: 'main' },
      );

      expect(result.compliant).toBe(false);
      expect(result.highestAction).toBe(ViolationAction.BLOCK);
      // Should trigger: org block (CRITICAL), project block (CVSS >= 8 on main)
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });

    it('should be compliant when no rules match', () => {
      const vulns: VulnerabilityData[] = [
        {
          id: 'vuln-1',
          name: 'Low Info Leak',
          severity: 'LOW',
          cvssScore: 2.0,
          scannerType: 'SECRET',
        },
      ];

      const result = evaluateVulnerabilitiesAgainstPolicies(
        vulns,
        allRules,
        [],
        { scanId: 'scan-1', branch: 'develop' },
      );

      expect(result.compliant).toBe(true);
      expect(result.highestAction).toBeNull();
      expect(result.violations).toHaveLength(0);
    });

    it('should respect exclusions at any level', () => {
      const vulns: VulnerabilityData[] = [
        {
          id: 'vuln-1',
          name: 'Critical in Test',
          severity: 'CRITICAL',
          cvssScore: 9.8,
          scannerType: 'SAST',
          filePath: 'test/unit/auth.test.ts',
        },
      ];

      const exclusions: PolicyExclusion[] = [
        { pattern: 'test/**', reason: 'Test files excluded' },
      ];

      const result = evaluateVulnerabilitiesAgainstPolicies(
        vulns,
        allRules,
        exclusions,
        { scanId: 'scan-1', branch: 'main' },
      );

      expect(result.compliant).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('Complex Real-World Scenario', () => {
    const complexRules: PolicyRule[] = [
      // Org level: Block all critical and high on production branches
      {
        id: 'org-prod-block',
        name: 'Block Critical/High on Prod',
        isEnabled: true,
        action: ViolationAction.BLOCK,
        type: RuleType.COMPOSITE_AND,
        criteria: [
          {
            id: 'severity-check',
            name: 'Critical or High',
            isEnabled: true,
            action: ViolationAction.BLOCK,
            type: RuleType.SEVERITY,
            operator: RuleOperator.IN,
            value: ['CRITICAL', 'HIGH'],
          },
          {
            id: 'branch-check',
            name: 'Prod Branches',
            isEnabled: true,
            action: ViolationAction.BLOCK,
            type: RuleType.BRANCH,
            operator: RuleOperator.IN,
            value: ['main', 'release/*', 'hotfix/*'],
          },
        ],
      },
      // Team level: Warn on SQL injection anywhere
      {
        id: 'team-sqli-warn',
        name: 'Warn on SQLi',
        isEnabled: true,
        action: ViolationAction.WARN,
        type: RuleType.CWE_CHECK,
        operator: RuleOperator.IN,
        value: ['CWE-89', 'CWE-564'],
      },
      // Project level: Block old unresolved vulns
      {
        id: 'project-old-vulns',
        name: 'Block Old Vulnerabilities',
        isEnabled: true,
        action: ViolationAction.BLOCK,
        type: RuleType.VULNERABILITY_AGE_DAYS,
        operator: RuleOperator.GTE,
        value: 90,
      },
    ];

    it('should handle multiple vulnerabilities with different outcomes', () => {
      const vulns: VulnerabilityData[] = [
        {
          id: 'vuln-critical-main',
          name: 'Critical on main',
          severity: 'CRITICAL',
          cvssScore: 9.0,
          scannerType: 'SAST',
        },
        {
          id: 'vuln-sqli',
          name: 'SQL Injection',
          severity: 'HIGH',
          cwe: ['CWE-89'],
          scannerType: 'SAST',
        },
        {
          id: 'vuln-low',
          name: 'Low issue',
          severity: 'LOW',
          cvssScore: 2.0,
          scannerType: 'SCA',
        },
      ];

      const result = evaluateVulnerabilitiesAgainstPolicies(
        vulns,
        complexRules,
        [],
        { scanId: 'scan-1', branch: 'main' },
      );

      expect(result.compliant).toBe(false);
      expect(result.highestAction).toBe(ViolationAction.BLOCK);

      // Should have violations for:
      // 1. Critical on main (org rule)
      // 2. SQLi HIGH on main (org rule + team rule)
      expect(result.violations.length).toBeGreaterThanOrEqual(3);

      // Verify specific violations
      const criticalViolations = result.violations.filter(
        (v) => v.vulnerabilityId === 'vuln-critical-main',
      );
      expect(criticalViolations.length).toBeGreaterThanOrEqual(1);

      const sqliViolations = result.violations.filter(
        (v) => v.vulnerabilityId === 'vuln-sqli',
      );
      expect(sqliViolations.length).toBeGreaterThanOrEqual(2); // org + team rules
    });

    it('should handle feature branch with different rules', () => {
      const vulns: VulnerabilityData[] = [
        {
          id: 'vuln-critical-feature',
          name: 'Critical on feature',
          severity: 'CRITICAL',
          cvssScore: 9.0,
          scannerType: 'SAST',
        },
      ];

      const result = evaluateVulnerabilitiesAgainstPolicies(
        vulns,
        complexRules,
        [],
        { scanId: 'scan-1', branch: 'feature/new-auth' },
      );

      // On feature branch, the org prod-block rule shouldn't match
      // Only if there's SQLi or old vuln would there be violations
      expect(result.compliant).toBe(true);
    });

    it('should block old vulnerabilities regardless of severity', () => {
      const vulns: VulnerabilityData[] = [
        {
          id: 'vuln-old-low',
          name: 'Old Low Issue',
          severity: 'LOW',
          cvssScore: 2.0,
          scannerType: 'SCA',
          createdAt: Date.now() - 100 * 24 * 60 * 60 * 1000, // 100 days old
        },
      ];

      const result = evaluateVulnerabilitiesAgainstPolicies(
        vulns,
        complexRules,
        [],
        { scanId: 'scan-1', branch: 'feature/old' },
      );

      expect(result.compliant).toBe(false);
      expect(result.highestAction).toBe(ViolationAction.BLOCK);
      expect(result.violations[0].ruleName).toBe('Block Old Vulnerabilities');
    });
  });

  describe('Priority and Action Escalation', () => {
    it('should escalate to BLOCK when any rule has BLOCK action', () => {
      const rules: PolicyRule[] = [
        {
          id: 'warn-rule',
          name: 'Warn High',
          isEnabled: true,
          action: ViolationAction.WARN,
          type: RuleType.SEVERITY,
          operator: RuleOperator.EQUALS,
          value: 'HIGH',
        },
        {
          id: 'block-rule',
          name: 'Block SAST',
          isEnabled: true,
          action: ViolationAction.BLOCK,
          type: RuleType.SCANNER_TYPE,
          operator: RuleOperator.EQUALS,
          value: 'SAST',
        },
      ];

      const vulns: VulnerabilityData[] = [
        {
          id: 'vuln-1',
          name: 'High SAST Issue',
          severity: 'HIGH',
          scannerType: 'SAST',
        },
      ];

      const result = evaluateVulnerabilitiesAgainstPolicies(vulns, rules, [], {
        scanId: 'scan-1',
        branch: 'main',
      });

      expect(result.highestAction).toBe(ViolationAction.BLOCK);
      expect(result.violations).toHaveLength(2);
    });

    it('should stay at WARN when all rules have WARN action', () => {
      const rules: PolicyRule[] = [
        {
          id: 'warn-rule-1',
          name: 'Warn High',
          isEnabled: true,
          action: ViolationAction.WARN,
          type: RuleType.SEVERITY,
          operator: RuleOperator.EQUALS,
          value: 'HIGH',
        },
        {
          id: 'warn-rule-2',
          name: 'Warn SAST',
          isEnabled: true,
          action: ViolationAction.WARN,
          type: RuleType.SCANNER_TYPE,
          operator: RuleOperator.EQUALS,
          value: 'SAST',
        },
      ];

      const vulns: VulnerabilityData[] = [
        {
          id: 'vuln-1',
          name: 'High SAST Issue',
          severity: 'HIGH',
          scannerType: 'SAST',
        },
      ];

      const result = evaluateVulnerabilitiesAgainstPolicies(vulns, rules, [], {
        scanId: 'scan-1',
        branch: 'main',
      });

      expect(result.highestAction).toBe(ViolationAction.WARN);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration-style tests for PolicyEvaluationProcessor class
// ---------------------------------------------------------------------------
describe('PolicyEvaluationProcessor — realtime publishing', () => {
  let processor: PolicyEvaluationProcessor;
  let publish: jest.Mock;

  beforeEach(async () => {
    publish = jest.fn().mockResolvedValue(undefined);

    const evaluationRepo = {
      update: jest.fn().mockResolvedValue(undefined),
    };
    const violationRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue({}),
    };
    const policyRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    const policyService = {
      getEffectivePolicy: jest.fn().mockResolvedValue({
        effectiveConfig: { rules: [], exclusions: [] },
        appliedPolicies: [],
      }),
    };
    const analysisGrpcClient = {
      getService: jest.fn().mockImplementation(() => {
        throw new Error('not needed');
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        PolicyEvaluationProcessor,
        {
          provide: getRepositoryToken(PolicyEvaluation),
          useValue: evaluationRepo,
        },
        {
          provide: getRepositoryToken(PolicyViolation),
          useValue: violationRepo,
        },
        { provide: getRepositoryToken(SecurityPolicy), useValue: policyRepo },
        { provide: PolicyService, useValue: policyService },
        { provide: 'ANALYSIS_REPORTING_SERVICE', useValue: analysisGrpcClient },
        { provide: RealtimeEventPublisher, useValue: { publish } },
      ],
    }).compile();

    processor = module.get(PolicyEvaluationProcessor);
    // onModuleInit swallows the error from the mocked grpc client
    try {
      processor.onModuleInit();
    } catch {
      /* expected */
    }
  });

  it('publishes POLICY_EVALUATION_COMPLETED after a successful evaluation', async () => {
    const job: any = {
      id: 'job-test-1',
      data: {
        evaluationId: 'eval-1',
        scanId: 'scan-1',
        projectId: 'proj-1',
        organizationId: 'org-1',
        branch: 'main',
      },
      updateProgress: jest.fn().mockResolvedValue(undefined),
    };

    await processor.process(job);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'POLICY_EVALUATION_COMPLETED',
        scope: expect.objectContaining({
          organizationId: 'org-1',
          projectId: 'proj-1',
          scanId: 'scan-1',
        }),
        payload: expect.objectContaining({
          policyEvaluationCompleted: expect.objectContaining({
            scanId: 'scan-1',
            projectId: 'proj-1',
            violationsCount: 0,
          }),
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// One hierarchy resolution per evaluation. triggerEvaluation already resolves
// the project's organization and team from global-management to know whether
// any policy applies; the job carries what the trigger resolved, so the
// processor does not resolve it a second time. A job queued before that field
// existed still resolves it here.
// ---------------------------------------------------------------------------
describe('PolicyEvaluationProcessor — project hierarchy from the job', () => {
  let processor: PolicyEvaluationProcessor;
  let getOrganizationIdByProjectId: jest.Mock;
  let getProject: jest.Mock;
  let orgPolicyFind: jest.Mock;
  let scopedPolicyQueries: { params: Record<string, unknown> }[];

  beforeEach(async () => {
    getOrganizationIdByProjectId = jest.fn(() =>
      of({ organizationId: 'org-gm' }),
    );
    getProject = jest.fn(() => of({ projectId: 'proj-1', teamId: 'team-gm' }));
    orgPolicyFind = jest.fn().mockResolvedValue([]);
    scopedPolicyQueries = [];

    const policyRepo = {
      find: orgPolicyFind,
      createQueryBuilder: jest.fn(() => {
        const query = { params: {} as Record<string, unknown> };
        scopedPolicyQueries.push(query);
        const qb: Record<string, jest.Mock> = {};
        for (const method of ['where', 'andWhere', 'orderBy']) {
          qb[method] = jest.fn((_sql: string, params?: object) => {
            Object.assign(query.params, params);
            return qb;
          });
        }
        qb.getMany = jest.fn().mockResolvedValue([]);
        return qb;
      }),
    };
    const services: Record<string, unknown> = {
      [ORGANIZATION_SERVICE_NAME]: { getOrganizationIdByProjectId },
      [PROJECT_SERVICE_NAME]: { get: getProject },
      [TEAM_SERVICE_NAME]: {},
    };

    const module = await Test.createTestingModule({
      providers: [
        PolicyEvaluationProcessor,
        PolicyService,
        {
          provide: getRepositoryToken(PolicyEvaluation),
          useValue: { update: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: getRepositoryToken(PolicyViolation),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        { provide: getRepositoryToken(SecurityPolicy), useValue: policyRepo },
        { provide: PolicyYamlService, useValue: {} },
        PolicyValidationService,
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: jest.fn((name: string) => services[name]) },
        },
        {
          provide: 'ANALYSIS_REPORTING_SERVICE',
          useValue: { getService: jest.fn(() => ({})) },
        },
      ],
    }).compile();

    module.get(PolicyService).onModuleInit();
    processor = module.get(PolicyEvaluationProcessor);
    processor.onModuleInit();
  });

  const jobWith = (
    data: Partial<PolicyEvaluationJobData>,
  ): Job<PolicyEvaluationJobData> =>
    ({
      id: 'job-l20',
      data: {
        evaluationId: 'eval-1',
        scanId: 'scan-1',
        projectId: 'proj-1',
        organizationId: 'org-1',
        triggeredBy: '',
        ...data,
      },
      updateProgress: jest.fn().mockResolvedValue(undefined),
    }) as unknown as Job<PolicyEvaluationJobData>;

  it('does not resolve the hierarchy in global-management when the job carries it', async () => {
    await processor.process(
      jobWith({ hierarchy: { organizationId: 'org-1', teamId: 'team-1' } }),
    );

    expect(getOrganizationIdByProjectId).not.toHaveBeenCalled();
    expect(getProject).not.toHaveBeenCalled();
    // The policies are still read for the job's organization and team.
    expect(orgPolicyFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1' }),
      }),
    );
    expect(scopedPolicyQueries.map((q) => q.params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ teamIds: JSON.stringify(['team-1']) }),
        expect.objectContaining({ projectIds: JSON.stringify(['proj-1']) }),
      ]),
    );
  });

  it('reads no team policy, and still no global-management, for a project without a team', async () => {
    await processor.process(
      jobWith({ hierarchy: { organizationId: 'org-1', teamId: null } }),
    );

    expect(getOrganizationIdByProjectId).not.toHaveBeenCalled();
    expect(getProject).not.toHaveBeenCalled();
    expect(
      scopedPolicyQueries.some((q) => q.params.teamIds !== undefined),
    ).toBe(false);
  });

  it('still resolves the hierarchy for a job queued before it carried one', async () => {
    await processor.process(jobWith({}));

    expect(getOrganizationIdByProjectId).toHaveBeenCalledTimes(1);
    // The tracing proxy appends the gRPC metadata: match the request only.
    expect(getOrganizationIdByProjectId.mock.calls[0][0]).toEqual({
      projectId: 'proj-1',
    });
    expect(orgPolicyFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-gm' }),
      }),
    );
    expect(scopedPolicyQueries.map((q) => q.params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ teamIds: JSON.stringify(['team-gm']) }),
      ]),
    );
  });
});

// The container findings (an image scan, a Trivy image import) are read with
// the others: without them, a policy on container CVEs (a severity rule, or
// « scanner type = container » the editor offers) never raises a violation.
describe('PolicyEvaluationProcessor — container findings', () => {
  let processor: PolicyEvaluationProcessor;
  let getProjectContainerVulnerabilities: jest.Mock;

  const detection = (id: string) => ({
    id,
    projectId: 'proj-1',
    vulnerabilityIdentifier: 'CVE-2021-3711',
    currentState: 'to_verify',
    currentSeverity: 'CRITICAL',
    currentPriority: 'urgent',
    fixedVersion: '1.1.1l-r0',
    package: {
      id: 'pkg-1',
      name: 'libssl1.1',
      version: '1.1.1g-r0',
      licenses: ['OpenSSL'],
    },
    vuln: {
      vulnerabilityId: 'CVE-2021-3711',
      pkgName: 'libssl1.1',
      title: 'openssl: SM2 Decryption Buffer Overflow',
      cweIds: ['CWE-120'],
      target: 'alpine:3.12.0 (alpine 3.12.0)',
    },
    cvssScore: 9.8,
    createdAt: '2026-11-05T22:04:22.000Z',
    branch: 'main',
  });

  beforeEach(async () => {
    getProjectContainerVulnerabilities = jest.fn((req: { page: number }) =>
      of({
        page: req.page,
        totalPages: 2,
        vulnerabilities: [detection(`det-${req.page}`)],
      }),
    );
    const resultService = {
      getProjectSastVulnerabilities: jest.fn(() => of({ vulnerabilities: [] })),
      getProjectIacVulnerabilities: jest.fn(() => of({ vulnerabilities: [] })),
      getProjectScaVulnerabilities: jest.fn(() => of({ vulnerabilities: [] })),
      getProjectSecretVulnerabilities: jest.fn(() =>
        of({ vulnerabilities: [] }),
      ),
      getProjectCicdVulnerabilities: jest.fn(() => of({ vulnerabilities: [] })),
      getProjectContainerVulnerabilities,
    };
    const module = await Test.createTestingModule({
      providers: [
        PolicyEvaluationProcessor,
        { provide: PolicyService, useValue: {} },
        { provide: getRepositoryToken(PolicyEvaluation), useValue: {} },
        { provide: getRepositoryToken(PolicyViolation), useValue: {} },
        { provide: getRepositoryToken(SecurityPolicy), useValue: {} },
        {
          provide: 'ANALYSIS_REPORTING_SERVICE',
          useValue: { getService: jest.fn(() => resultService) },
        },
      ],
    }).compile();
    processor = module.get(PolicyEvaluationProcessor);
    processor.onModuleInit();
  });

  const fetchAll = () =>
    (
      processor as unknown as {
        fetchAllVulnerabilities(
          p: string,
          s: string,
        ): Promise<VulnerabilityData[]>;
      }
    ).fetchAllVulnerabilities('proj-1', 'scan-1');

  it('reads every page of the container findings', async () => {
    const vulns = await fetchAll();
    const containers = vulns.filter((v) => v.scannerType === 'CONTAINER');
    expect(containers.map((v) => v.id)).toEqual(['det-1', 'det-2']);
    expect(getProjectContainerVulnerabilities).toHaveBeenCalledTimes(2);
    for (const [req] of getProjectContainerVulnerabilities.mock.calls) {
      expect(req).toEqual(
        expect.objectContaining({ projectId: 'proj-1', limit: 500 }),
      );
    }
  });

  it('maps a container finding to what the rules read', async () => {
    const [v] = (await fetchAll()).filter((x) => x.scannerType === 'CONTAINER');
    expect(v).toEqual(
      expect.objectContaining({
        id: 'det-1',
        name: 'openssl: SM2 Decryption Buffer Overflow',
        severity: 'CRITICAL',
        cvssScore: 9.8,
        cwe: ['CWE-120'],
        packageName: 'libssl1.1',
        packageVersion: '1.1.1g-r0',
        status: 'to_verify',
        branch: 'main',
        scannerType: 'CONTAINER',
      }),
    );
    expect(v.createdAt).toBe(Date.parse('2026-11-05T22:04:22.000Z'));
  });
});

/**
 * Stale violations are removed by comparing what this evaluation matched with
 * what is stored. A findings type that could not be fetched (a gRPC error, a
 * response past the 50 MB message limit) looked like a type with no finding:
 * every violation it held was then removed as fixed. An evaluation missing a
 * type now keeps the stored violations.
 */
describe('PolicyEvaluationProcessor — an incomplete fetch removes no violation', () => {
  let processor: PolicyEvaluationProcessor;
  let resultService: Record<string, jest.Mock>;

  beforeEach(async () => {
    const empty = () => of({ vulnerabilities: [] });
    resultService = {
      getProjectSastVulnerabilities: jest.fn(empty),
      getProjectIacVulnerabilities: jest.fn(empty),
      getProjectScaVulnerabilities: jest.fn(() =>
        throwError(() => new Error('8 RESOURCE_EXHAUSTED: message too large')),
      ),
      getProjectSecretVulnerabilities: jest.fn(empty),
      getProjectCicdVulnerabilities: jest.fn(empty),
      getProjectContainerVulnerabilities: jest.fn(() =>
        of({ page: 1, totalPages: 1, vulnerabilities: [] }),
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        PolicyEvaluationProcessor,
        {
          provide: PolicyService,
          useValue: {
            getEffectivePolicy: jest.fn(async () => ({
              effectiveConfig: { rules: [], exclusions: [] },
              appliedPolicies: [{ id: 'policy-1' }],
            })),
          },
        },
        { provide: getRepositoryToken(PolicyEvaluation), useValue: {} },
        {
          provide: getRepositoryToken(PolicyViolation),
          useValue: {
            manager: {
              transaction: async (
                work: (em: unknown) => Promise<unknown>,
              ): Promise<unknown> =>
                work({ query: async () => [], getRepository: () => ({}) }),
            },
          },
        },
        { provide: getRepositoryToken(SecurityPolicy), useValue: {} },
        {
          provide: 'ANALYSIS_REPORTING_SERVICE',
          useValue: { getService: jest.fn(() => resultService) },
        },
      ],
    }).compile();
    processor = module.get(PolicyEvaluationProcessor);
    processor.onModuleInit();
  });

  const internals = () =>
    processor as unknown as Record<string, (...args: unknown[]) => unknown>;

  const run = async () => {
    const p = internals();
    jest.spyOn(p as any, 'updateEvaluationStatus').mockResolvedValue(undefined);
    jest.spyOn(p as any, 'waitForQueueCompletion').mockResolvedValue(true);
    const cleanup = jest
      .spyOn(p as any, 'cleanupStaleViolations')
      .mockResolvedValue(undefined);
    const complete = jest
      .spyOn(p as any, 'completeEvaluation')
      .mockResolvedValue(undefined);
    await processor.process({
      id: 'job-1',
      data: {
        evaluationId: 'eval-1',
        scanId: 'scan-1',
        projectId: 'proj-1',
        organizationId: 'org-1',
        branch: 'main',
      },
      updateProgress: jest.fn(),
    } as any);
    return { cleanup, complete };
  };

  it('names the types it could not fetch', async () => {
    const report = await (
      internals() as unknown as {
        fetchVulnerabilitiesReport(
          p: string,
          s: string,
        ): Promise<{ vulnerabilities: unknown[]; failedTypes: string[] }>;
      }
    ).fetchVulnerabilitiesReport('proj-1', 'scan-1');
    expect(report.failedTypes).toEqual(['SCA']);
  });

  it('keeps the stored violations when a type could not be fetched', async () => {
    const { cleanup, complete } = await run();
    expect(cleanup).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalled();
  });

  it('still removes the stale violations after a complete fetch', async () => {
    resultService.getProjectScaVulnerabilities.mockImplementation(() =>
      of({ vulnerabilities: [] }),
    );
    const { cleanup } = await run();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
