/**
 * Extension token: the analyses a closed extension attaches to the
 * findings of the CWE and OWASP reports, and how the report templates print
 * them. Its value is a ReportAnalysisPort. Only an ee module supplies it; when
 * the token is absent — the Community Edition — no analysis is loaded and the
 * templates render with NO_REPORT_ANALYSIS, which prints none.
 */
export const REPORT_ANALYSIS = 'REPORT_ANALYSIS';

/** Detection families a report asks analyses for. */
export type ReportAnalysisFamily = 'sast' | 'iac' | 'sca' | 'container';

/** An analysis attached to a finding of a report. */
export interface ReportFindingAnalysis {
  /** Text of the analysis (Markdown), secrets already masked. */
  readonly markdown: string;
  /** ISO date of the analysis. */
  readonly date: string;
  /** Link to the finding, when the extension knows one. */
  readonly url?: string;
}

/** What a report finding hands the renderer. */
export interface ReportAnalysisFinding {
  readonly id: string;
  readonly cybeAnalysis?: ReportFindingAnalysis;
  readonly exploitability?: {
    readonly verdict: string;
    readonly source: string;
    readonly score?: number | null;
    readonly reason?: string | null;
  } | null;
}

/** An analysed occurrence, as the templates read it back. */
export interface ReportAnalysisSource {
  readonly id: string;
  readonly pinned: { readonly date: string };
  /** The finding carries a verdict of its own analysis. */
  readonly agentVerdict: unknown;
}

/** A printable box, as the templates read it back. */
export interface ReportAnalysisBrief {
  /** The head carries a verdict. */
  readonly pill: unknown;
  readonly url?: string;
}

/** A printable triage line (opaque to the templates). */
export type ReportAnalysisTriageLine = object;

/** What the printed boxes show (opaque to the templates). */
export type ReportAnalysisParts = object;

export interface ReportAnalysisBriefOptions {
  title: string;
  known: string;
  occurrences: number;
  unit: 'occurrence' | 'package';
  compact: boolean;
  withPill: boolean;
}

export interface ReportAnalysisAboutFacts {
  covered: number;
  triage: boolean;
  links: boolean;
  every: ReportAnalysisParts;
  some: ReportAnalysisParts;
  analysisVerdict?: boolean;
  triageCodeOnly?: boolean;
}

/** How the report templates print the analyses of their findings. */
export interface ReportAnalysisRenderer {
  /** The source of a finding, or null when it carries no printable analysis. */
  briefSource(
    v: ReportAnalysisFinding,
    location: string,
  ): ReportAnalysisSource | null;
  buildBrief(
    sources: ReportAnalysisSource[],
    opts: ReportAnalysisBriefOptions,
  ): ReportAnalysisBrief | null;
  buildTriageLine(
    sources: ReportAnalysisSource[],
    opts: { scopeId: string | null; title: string; known: string },
  ): ReportAnalysisTriageLine | null;
  card(
    brief: ReportAnalysisBrief,
    opts: { compact: boolean; confidenceWord: boolean },
  ): string;
  triageLineHtml(
    line: ReportAnalysisTriageLine,
    scopeId: string | null,
  ): string;
  continuation(label: string): string;
  briefParts(
    briefs: readonly ReportAnalysisBrief[],
    quantifier: 'every' | 'some',
  ): ReportAnalysisParts;
  briefContent(every: ReportAnalysisParts): string;
  readonly noBriefParts: ReportAnalysisParts;
  aboutParagraph(facts: ReportAnalysisAboutFacts): string;
  /** Styles a report adds only once it prints a box or a triage line. */
  readonly css: string;
}

export interface ReportAnalysisPort {
  /** The analysis of each given detection that has one. Never throws. */
  load(
    projectId: string,
    family: ReportAnalysisFamily,
    detectionIds: readonly string[],
  ): Promise<Map<string, ReportFindingAnalysis>>;
  readonly renderer: ReportAnalysisRenderer;
}

const NO_PARTS: ReportAnalysisParts = Object.freeze({});

/** Prints no analysis: no finding has a source, so no box is ever built. */
export const NO_REPORT_ANALYSIS: ReportAnalysisRenderer = Object.freeze({
  briefSource: () => null,
  buildBrief: () => null,
  buildTriageLine: () => null,
  card: () => '',
  triageLineHtml: () => '',
  continuation: () => '',
  briefParts: () => NO_PARTS,
  briefContent: () => '',
  noBriefParts: NO_PARTS,
  aboutParagraph: () => '',
  css: '',
});
