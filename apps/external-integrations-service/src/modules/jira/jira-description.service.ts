import { Injectable } from '@nestjs/common';
import { VulnerabilityInfo } from '@grpc/external-integrations/issue';

/**
 * Generates Jira issue descriptions in ADF (Atlassian Document Format).
 *
 * ADF is the JSON-based format used by Jira Cloud REST API v3.
 * Unlike GitHub/GitLab which use Markdown, Jira v3 requires ADF.
 *
 * Per US 3.1: Excludes "How to prevent" section.
 * Includes: type, file/line, technical explanation, CybeDefend link.
 */
@Injectable()
export class JiraDescriptionService {
  /**
   * Builds an ADF document for a single vulnerability.
   */
  buildSingleVulnerabilityDescription(
    vuln: VulnerabilityInfo,
    cybedefendBaseUrl: string,
  ): Record<string, unknown> {
    const content: Record<string, unknown>[] = [];

    // Vulnerability details heading
    content.push(this.heading('Vulnerability Details', 2));

    // Info table
    const tableRows: Record<string, unknown>[] = [];
    tableRows.push(
      this.tableRow('Type', vuln.scannerType?.toUpperCase() || 'N/A'),
    );
    tableRows.push(
      this.tableRow('Severity', vuln.severity?.toUpperCase() || 'N/A'),
    );

    if (vuln.cvssScore) {
      tableRows.push(this.tableRow('CVSS Score', vuln.cvssScore.toString()));
    }
    if (vuln.filePath) {
      const location = vuln.startLine
        ? `${vuln.filePath}:${vuln.startLine}${vuln.endLine ? `-${vuln.endLine}` : ''}`
        : vuln.filePath;
      tableRows.push(this.tableRow('Location', location));
    }
    if (vuln.cwe && vuln.cwe.length > 0) {
      tableRows.push(this.tableRow('CWE', vuln.cwe.join(', ')));
    }
    if (vuln.owaspTop10 && vuln.owaspTop10.length > 0) {
      tableRows.push(this.tableRow('OWASP Top 10', vuln.owaspTop10.join(', ')));
    }
    if (vuln.packageName) {
      tableRows.push(
        this.tableRow(
          'Package',
          `${vuln.packageName}@${vuln.packageVersion || 'unknown'}`,
        ),
      );
    }
    if (vuln.fixedVersion) {
      tableRows.push(this.tableRow('Fixed Version', vuln.fixedVersion));
    }
    if (vuln.externalId) {
      tableRows.push(this.tableRow('External ID', vuln.externalId));
    }
    if (vuln.branch) {
      tableRows.push(this.tableRow('Branch', vuln.branch));
    }

    content.push(this.table(tableRows));

    // Technical description (short description only, no "how to prevent")
    if (vuln.shortDescription) {
      content.push(this.heading('Description', 3));
      content.push(this.paragraph(vuln.shortDescription));
    }

    // CybeDefend link
    const cybedefendUrl = vuln.cybedefendUrl || cybedefendBaseUrl;
    content.push(this.heading('View in CybeDefend', 3));
    content.push(this.paragraphWithLink('Open in CybeDefend', cybedefendUrl));

    return this.document(content);
  }

  /**
   * Builds an ADF document for grouped vulnerabilities (by type or file).
   */
  buildGroupedVulnerabilityDescription(
    vulnerabilities: VulnerabilityInfo[],
    groupLabel: string,
    cybedefendBaseUrl: string,
  ): Record<string, unknown> {
    const content: Record<string, unknown>[] = [];

    content.push(this.heading(`${groupLabel}`, 2));
    content.push(
      this.paragraph(
        `${vulnerabilities.length} vulnerabilit${vulnerabilities.length === 1 ? 'y' : 'ies'} detected.`,
      ),
    );

    // Summary table
    const tableRows: Record<string, unknown>[] = [];
    for (const vuln of vulnerabilities) {
      const location = vuln.filePath
        ? `${vuln.filePath}${vuln.startLine ? `:${vuln.startLine}` : ''}`
        : 'N/A';
      tableRows.push(
        this.tableRow(
          vuln.name || vuln.externalId || 'Unknown',
          `${vuln.severity?.toUpperCase() || 'N/A'} | ${location}`,
        ),
      );
    }
    content.push(this.table(tableRows));

    // Link to CybeDefend
    content.push(this.heading('View in CybeDefend', 3));
    content.push(
      this.paragraphWithLink('Open project in CybeDefend', cybedefendBaseUrl),
    );

    return this.document(content);
  }

  /**
   * Generates the Jira issue summary (title) per US 3.1.
   * Sanitizes control characters and enforces Jira's 255-char limit.
   */
  buildIssueSummary(vulnName: string): string {
    const sanitized = this.sanitizeForAdf(vulnName, 240);
    return `[CybeDefend] ${sanitized}`.substring(0, 255);
  }

  /**
   * Maps CybeDefend severity to Jira priority name per US 3.2.
   */
  mapSeverityToPriority(severity: string): { id: string; name: string } {
    const mapping: Record<string, { id: string; name: string }> = {
      critical: { id: '1', name: 'Highest' },
      high: { id: '2', name: 'High' },
      medium: { id: '3', name: 'Medium' },
      low: { id: '4', name: 'Low' },
      info: { id: '5', name: 'Lowest' },
    };
    return mapping[severity?.toLowerCase()] || mapping.medium;
  }

  /**
   * Builds ADF content nodes for a "linked vulnerabilities" section
   * to append to an existing Jira ticket description.
   */
  buildLinkedVulnerabilitiesSection(
    count: number,
    scannerType: string,
    vulnerabilities?: Array<{
      name?: string;
      severity?: string;
      filePath?: string;
      startLine?: number;
    }>,
    cybedefendUrl?: string,
  ): Record<string, unknown>[] {
    const date = new Date().toISOString().split('T')[0];
    const type = scannerType?.toUpperCase() || 'N/A';
    const nodes: Record<string, unknown>[] = [
      this.rule(),
      this.heading('Linked from CybeDefend', 3),
      this.paragraph(
        `${count} ${type} vulnerabilit${count === 1 ? 'y' : 'ies'} linked on ${date}.`,
      ),
    ];

    if (vulnerabilities && vulnerabilities.length > 0) {
      const tableRows = vulnerabilities.map((v) => {
        const location = v.filePath
          ? `${v.filePath}${v.startLine ? `:${v.startLine}` : ''}`
          : 'N/A';
        return this.tableRow(
          v.name || 'Unknown',
          `${v.severity?.toUpperCase() || 'N/A'} | ${location}`,
        );
      });
      nodes.push(this.table(tableRows));
    }

    if (cybedefendUrl) {
      nodes.push(this.paragraphWithLink('View in CybeDefend', cybedefendUrl));
    }

    return nodes;
  }

  /**
   * Appends content nodes to an existing ADF document.
   * If the existing description is null/empty, creates a new document.
   */
  appendToDescription(
    existing: Record<string, unknown> | null | undefined,
    nodes: Record<string, unknown>[],
  ): Record<string, unknown> {
    if (
      existing &&
      existing.type === 'doc' &&
      Array.isArray(existing.content)
    ) {
      return {
        ...existing,
        content: [...(existing.content as Record<string, unknown>[]), ...nodes],
      };
    }
    return this.document(nodes);
  }

  // ========== ADF Building Helpers ==========

  private document(
    content: Record<string, unknown>[],
  ): Record<string, unknown> {
    return {
      version: 1,
      type: 'doc',
      content,
    };
  }

  private heading(text: string, level: number): Record<string, unknown> {
    return {
      type: 'heading',
      attrs: { level },
      content: [{ type: 'text', text: this.sanitizeForAdf(text, 255) }],
    };
  }

  private paragraph(text: string): Record<string, unknown> {
    return {
      type: 'paragraph',
      content: [{ type: 'text', text: this.sanitizeForAdf(text) }],
    };
  }

  private paragraphWithLink(
    text: string,
    url: string,
  ): Record<string, unknown> {
    return {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: this.sanitizeForAdf(text),
          marks: [
            {
              type: 'link',
              attrs: { href: url },
            },
          ],
        },
      ],
    };
  }

  private rule(): Record<string, unknown> {
    return { type: 'rule' };
  }

  private table(rows: Record<string, unknown>[]): Record<string, unknown> {
    return {
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'default' },
      content: rows,
    };
  }

  private tableRow(label: string, value: string): Record<string, unknown> {
    return {
      type: 'tableRow',
      content: [
        {
          type: 'tableHeader',
          content: [this.paragraph(label)],
        },
        {
          type: 'tableCell',
          content: [this.paragraph(value)],
        },
      ],
    };
  }

  /**
   * Sanitizes text for safe inclusion in ADF documents.
   * Strips control characters (except \t, \n, \r) and enforces length limits.
   */
  private sanitizeForAdf(text: unknown, maxLength = 10000): string {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .substring(0, maxLength);
  }
}
