import {
  codeAutofixExistsSql,
  scaFixAvailableExistsSql,
} from './autofix-exists-sql';

describe('codeAutofixExistsSql', () => {
  it("keeps today's subquery text on MySQL", () => {
    expect(codeAutofixExistsSql('vulnDetection.id', 'mysql')).toBe(
      'SELECT 1 FROM autofix_records afr WHERE afr.detectionId = vulnDetection.id',
    );
    expect(codeAutofixExistsSql('`det`.`id`', 'mysql')).toBe(
      'SELECT 1 FROM autofix_records afr WHERE afr.detectionId = `det`.`id`',
    );
  });

  it('quotes the camelCase column on PostgreSQL, where it folds to lower case', () => {
    expect(codeAutofixExistsSql('vulnDetection.id', 'postgres')).toBe(
      'SELECT 1 FROM autofix_records afr WHERE "afr"."detectionId" = vulnDetection.id',
    );
  });
});

describe('scaFixAvailableExistsSql', () => {
  it("keeps today's subquery text on MySQL", () => {
    expect(scaFixAvailableExistsSql('vulnDetection.id', 'mysql')).toBe(
      'SELECT 1 FROM sca_autofix_records sar WHERE sar.scaVulnerabilityDetectionId = vulnDetection.id AND sar.hasFixAvailable = 1',
    );
  });

  it('quotes the columns and compares a boolean on PostgreSQL', () => {
    expect(scaFixAvailableExistsSql('vulnDetection.id', 'postgres')).toBe(
      'SELECT 1 FROM sca_autofix_records sar WHERE "sar"."scaVulnerabilityDetectionId" = vulnDetection.id AND "sar"."hasFixAvailable" = true',
    );
  });
});
