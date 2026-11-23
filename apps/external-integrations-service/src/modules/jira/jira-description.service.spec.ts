import { JiraDescriptionService } from './jira-description.service';

describe('JiraDescriptionService', () => {
  let service: JiraDescriptionService;

  beforeEach(() => {
    service = new JiraDescriptionService();
  });

  describe('buildLinkedVulnerabilitiesSection', () => {
    it('should return ADF nodes with rule, heading, and paragraph', () => {
      const nodes = service.buildLinkedVulnerabilitiesSection(3, 'sast');

      expect(nodes).toHaveLength(3);
      expect(nodes[0]).toEqual({ type: 'rule' });
      expect(nodes[1]).toMatchObject({
        type: 'heading',
        attrs: { level: 3 },
      });
      expect(nodes[2]).toMatchObject({ type: 'paragraph' });
    });

    it('should include count, scanner type, and date in paragraph', () => {
      const nodes = service.buildLinkedVulnerabilitiesSection(5, 'sca');
      const text = ((nodes[2].content as any[])[0] as { text: string }).text;

      expect(text).toContain('5');
      expect(text).toContain('SCA');
      expect(text).toContain('vulnerabilities');
      expect(text).toMatch(/\d{4}-\d{2}-\d{2}/); // date format
    });

    it('should use singular "vulnerability" for count 1', () => {
      const nodes = service.buildLinkedVulnerabilitiesSection(1, 'sast');
      const text = ((nodes[2].content as any[])[0] as { text: string }).text;

      expect(text).toContain('1 SAST vulnerability');
      expect(text).not.toContain('vulnerabilities');
    });

    it('should include a table when vulnerabilities are provided', () => {
      const vulns = [
        {
          name: 'SQL Injection',
          severity: 'high',
          filePath: 'src/db.ts',
          startLine: 42,
        },
        { name: 'XSS', severity: 'medium', filePath: 'src/render.ts' },
      ];
      const nodes = service.buildLinkedVulnerabilitiesSection(2, 'sast', vulns);

      // rule + heading + paragraph + table = 4 nodes
      expect(nodes).toHaveLength(4);
      expect(nodes[3]).toMatchObject({ type: 'table' });

      // Table should have 2 rows
      const tableContent = nodes[3].content as any[];
      expect(tableContent).toHaveLength(2);
    });

    it('should not include a table when vulnerabilities array is empty', () => {
      const nodes = service.buildLinkedVulnerabilitiesSection(0, 'sast', []);
      expect(nodes).toHaveLength(3); // rule + heading + paragraph, no table
    });
  });

  describe('sanitizeForAdf', () => {
    it('should strip null bytes', () => {
      const result = (service as any).sanitizeForAdf('hello\x00world');
      expect(result).toBe('helloworld');
    });

    it('should strip control characters except newlines and tabs', () => {
      const result = (service as any).sanitizeForAdf('hello\x01\x02\nworld\t!');
      expect(result).toBe('hello\nworld\t!');
    });

    it('should preserve carriage returns', () => {
      const result = (service as any).sanitizeForAdf('hello\rworld');
      expect(result).toBe('hello\rworld');
    });

    it('should truncate to maxLength', () => {
      const result = (service as any).sanitizeForAdf('a'.repeat(300), 255);
      expect(result).toHaveLength(255);
    });

    it('should handle empty/null/undefined input', () => {
      expect((service as any).sanitizeForAdf('')).toBe('');
      expect((service as any).sanitizeForAdf(null)).toBe('');
      expect((service as any).sanitizeForAdf(undefined)).toBe('');
    });

    it('should handle non-string input', () => {
      expect((service as any).sanitizeForAdf(12345)).toBe('');
    });
  });

  describe('buildIssueSummary', () => {
    it('should truncate summary to 255 characters', () => {
      const longName = 'A'.repeat(300);
      const result = service.buildIssueSummary(longName);
      expect(result.length).toBeLessThanOrEqual(255);
      expect(result.startsWith('[CybeDefend] ')).toBe(true);
    });

    it('should sanitize control characters in summary', () => {
      const result = service.buildIssueSummary('vuln\x00name\x01test');
      expect(result).toBe('[CybeDefend] vulnnametest');
    });
  });

  describe('paragraph helper sanitization', () => {
    it('should sanitize text in paragraph nodes', () => {
      const nodes = service.buildLinkedVulnerabilitiesSection(
        1,
        'sast\x00injected',
      );
      const paragraphText = ((nodes[2].content as any[])[0] as { text: string })
        .text;
      expect(paragraphText).not.toContain('\x00');
    });

    it('should sanitize text in heading nodes', () => {
      const nodes = service.buildLinkedVulnerabilitiesSection(1, 'sast');
      const headingText = ((nodes[1].content as any[])[0] as { text: string })
        .text;
      expect(headingText).not.toContain('\x00');
    });
  });

  describe('appendToDescription', () => {
    it('should append nodes to existing ADF document', () => {
      const existing = {
        version: 1,
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        ],
      };
      const newNodes = [{ type: 'rule' }, { type: 'paragraph', content: [] }];

      const result = service.appendToDescription(existing, newNodes);

      expect(result.type).toBe('doc');
      expect((result.content as any[]).length).toBe(3); // 1 existing + 2 new
      expect((result.content as any[])[0].type).toBe('paragraph');
      expect((result.content as any[])[1].type).toBe('rule');
    });

    it('should create new document when existing is null', () => {
      const nodes = [{ type: 'paragraph', content: [] }];
      const result = service.appendToDescription(null, nodes);

      expect(result.type).toBe('doc');
      expect(result.version).toBe(1);
      expect((result.content as any[]).length).toBe(1);
    });

    it('should create new document when existing is not a valid ADF doc', () => {
      const result = service.appendToDescription({ foo: 'bar' } as any, [
        { type: 'rule' },
      ]);

      expect(result.type).toBe('doc');
      expect(result.version).toBe(1);
    });
  });
});
