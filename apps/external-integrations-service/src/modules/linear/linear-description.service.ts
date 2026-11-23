import { Injectable } from '@nestjs/common';
import {
  IssueCreationMode,
  VulnerabilityInfo,
} from '@grpc/external-integrations/issue';
import {
  normalizeIssueCreationMode,
  vulnerabilityDisplayName,
} from '../issue/issue-grouping';

export type LinearPriority = 0 | 1 | 2 | 3 | 4;

const TITLE_PREFIX = '[CybeDefend] ';
const MAX_TITLE_LENGTH = 255;
// A ticket for a large group lists this many occurrences, then a count.
const MAX_LISTED_OCCURRENCES = 50;
// One field of a finding never fills the description on its own.
const MAX_TEXT_LENGTH = 1000;

// Linear priorities: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
const PRIORITY_BY_SEVERITY: Record<string, LinearPriority> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

// Every C0 and C1 control character, line breaks and tabs included.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]+/g;
// What could turn finding text into a link, an image, HTML, emphasis, code, a
// table or a heading.
const MARKDOWN_MARKUP = /[\\`*_[\]<>|~#]/g;

/**
 * The title and the Markdown description of a Linear ticket created from
 * findings: the content of JiraDescriptionService (no remediation text), in
 * English.
 *
 * Every text comes from the finding's metadata (`VulnerabilityInfo`), never
 * from code. It is written as plain text: Markdown markup in it is escaped,
 * and paths, packages and versions are code spans. The only link is the
 * CybeDefend group URL the caller built.
 */
@Injectable()
export class LinearDescriptionService {
  severityToPriority(severity: string): LinearPriority {
    return PRIORITY_BY_SEVERITY[severity?.toLowerCase()] ?? 0;
  }

  /** `[CybeDefend] …`, on one line, 255 characters at most. */
  buildTitle(
    vulns: VulnerabilityInfo[],
    mode: IssueCreationMode,
    groupKey: string,
  ): string {
    const count = vulns.length;
    const name = vulnerabilityDisplayName(vulns[0]);
    let subject: string;
    switch (normalizeIssueCreationMode(mode)) {
      case 'per_vulnerability':
        subject = name;
        break;
      case 'per_file':
        subject = `${count} ${plural(count, 'vulnerability', 'vulnerabilities')} in ${groupKey}`;
        break;
      default:
        subject = `${name} (${count} ${plural(count, 'occurrence', 'occurrences')})`;
    }
    return clip(`${TITLE_PREFIX}${oneLine(subject)}`, MAX_TITLE_LENGTH);
  }

  /**
   * The details of a single finding, or the list of a group's occurrences (50
   * at most, then how many more), and the link to the group in CybeDefend.
   */
  buildDescription(vulns: VulnerabilityInfo[], groupUrl: string): string {
    const body =
      vulns.length === 1
        ? this.findingDetails(vulns[0])
        : this.occurrenceList(vulns);
    return [
      ...body,
      '',
      '### View in CybeDefend',
      '',
      `[Open in CybeDefend](${linkDestination(groupUrl)})`,
      '',
    ].join('\n');
  }

  private findingDetails(vuln: VulnerabilityInfo): string[] {
    const fields: Array<[string, string]> = [
      ['Vulnerability', text(vulnerabilityDisplayName(vuln))],
      ['Type', text(vuln.scannerType?.toUpperCase()) || 'N/A'],
      ['Severity', text(vuln.severity?.toUpperCase()) || 'N/A'],
    ];
    if (vuln.cvssScore) fields.push(['CVSS score', String(vuln.cvssScore)]);
    if (vuln.filePath) {
      const lines =
        vuln.startLine > 0
          ? `:${vuln.startLine}${vuln.endLine > vuln.startLine ? `-${vuln.endLine}` : ''}`
          : '';
      fields.push(['Location', code(`${vuln.filePath}${lines}`)]);
    }
    if (vuln.cwe?.length) fields.push(['CWE', text(vuln.cwe.join(', '))]);
    if (vuln.owaspTop10?.length) {
      fields.push(['OWASP Top 10', text(vuln.owaspTop10.join(', '))]);
    }
    if (vuln.packageName) fields.push(['Package', code(packageOf(vuln))]);
    if (vuln.fixedVersion) {
      fields.push(['Fixed version', code(vuln.fixedVersion)]);
    }
    if (vuln.externalId) fields.push(['External ID', text(vuln.externalId)]);
    if (vuln.branch) fields.push(['Branch', code(vuln.branch)]);

    const lines = [
      '## Vulnerability details',
      '',
      ...fields.map(([label, value]) => `- **${label}:** ${value}`),
    ];
    const summary = text(vuln.shortDescription);
    if (summary) lines.push('', '### Description', '', summary);
    return lines;
  }

  private occurrenceList(vulns: VulnerabilityInfo[]): string[] {
    const listed = vulns.slice(0, MAX_LISTED_OCCURRENCES).map((vuln) => {
      const parts = [
        `**${text(vuln.severity?.toUpperCase()) || 'N/A'}**`,
        text(vulnerabilityDisplayName(vuln)),
      ];
      if (vuln.packageName) {
        parts.push(code(packageOf(vuln)));
        if (vuln.fixedVersion) {
          parts.push(`fixed in ${code(vuln.fixedVersion)}`);
        }
      }
      if (vuln.filePath) {
        parts.push(
          code(
            `${vuln.filePath}${vuln.startLine > 0 ? `:${vuln.startLine}` : ''}`,
          ),
        );
      }
      return `- ${parts.join(' · ')}`;
    });

    const lines = [
      '## Occurrences',
      '',
      `${vulns.length} vulnerabilities detected.`,
      '',
      ...listed,
    ];
    const more = vulns.length - listed.length;
    if (more > 0) lines.push('', `… and ${more} more.`);
    return lines;
  }
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Cut to `max` characters (code points), the last one an ellipsis. */
function clip(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return `${chars.slice(0, max - 1).join('')}…`;
}

function oneLine(value: string | undefined): string {
  return (value ?? '').replace(CONTROL_CHARACTERS, ' ').trim();
}

/** Finding text as Markdown that renders as the text itself. */
function text(value: string | undefined): string {
  return clip(oneLine(value), MAX_TEXT_LENGTH).replace(MARKDOWN_MARKUP, '\\$&');
}

/** A code span: nothing in it is Markdown, and it cannot be closed early. */
function code(value: string): string {
  return `\`${clip(oneLine(value).replace(/`/g, "'"), MAX_TEXT_LENGTH)}\``;
}

function packageOf(vuln: VulnerabilityInfo): string {
  return `${vuln.packageName}@${vuln.packageVersion || 'unknown'}`;
}

/**
 * A URL a Markdown link destination cannot end early. `encodeURIComponent`
 * leaves parentheses as they are (the group URL's search can hold some).
 */
function linkDestination(url: string): string {
  return url.replace(/[()\s]/g, (char) => {
    if (char === '(') return '%28';
    if (char === ')') return '%29';
    return encodeURIComponent(char);
  });
}
