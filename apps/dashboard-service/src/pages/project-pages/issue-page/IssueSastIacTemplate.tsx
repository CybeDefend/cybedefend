import React, { useEffect, useState } from "react";
import SafeMarkdown from '@/components/atoms/safe-markdown/SafeMarkdown';
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import SeverityBadge from "../../../components/atoms/badge/SeverityBadge";
import SeverityChip, { priorityChipLevel } from '@/components/atoms/badge/SeverityChip';
import BackButton from "../../../components/atoms/button/BackButton";
import useSmartBack from "../../../server/hooks/useSmartBack";
import { productHome, projectPath } from "@/utils/product";
import Button from "../../../components/atoms/button/Button";
import { Slot, useSlotEntries } from "@/edition/slots";

import Card from "../../../components/atoms/card/Card";
import CodeSnippet from "../../../components/molecules/issue/code-snippet/CodeSnippet";
import DataFlow from "../../../components/molecules/issue/dataflow/DataFlow";
import HistoryTimeline from "../../../components/molecules/issue/history-timeline/HistoryTimeline";
import NotFoundElement from "../../../components/molecules/not-found-element/NotFoundElement";
import UpdateVulnerabilityModal from "../../../components/molecules/modal/update-vulnerability-modal/UpdateVulnerabilityModal";
import { CicdVulnerabilityResult, IacVulnerabilityResult, SastVulnerabilityResult, SecretVulnerabilityResult } from "../../../server/interfaces/Vulnerability";
import { cn, convertDate, getPriorityLabel, getStatusLabel } from "../../../utils/function/utils";
import CodeExampleViewer from "../../../components/molecules/issue/code-example-viewer/CodeExampleViewer";
import ScoringExploitabilityTab from "@/components/molecules/scoring/ScoringExploitabilityTab";
import CvssScoreCard from "@/components/molecules/scoring/CvssScoreCard";
import ExploitabilityMetaTile from '@/components/molecules/issue/exploitability-meta-tile/ExploitabilityMetaTile';
import { pickCvssForTable } from '@/utils/data/resultsVulnData';
import { cvssScoreColorClass } from '@/utils/function/issueMetaColors';
import LanguageLogo from '@/components/atoms/language-logo/LanguageLogo';
import TicketTracker from "../../../components/molecules/ticket-tracker/TicketTracker";
import { trackingForBranch, type IssueTracking } from "../../../server/hooks/useIssueTracking";
import SecretRevealCard from "../../../components/molecules/issue/secret-reveal-card/SecretRevealCard";
import { useRotateSecret } from "../../../server/hooks/useSecretActions";
import { buildIgnoreDirective } from "@/utils/ignoreDirective";
import IssueTabButton from "./IssueTabButton";
import { AlertTriangle, Bug, CalendarAlt, Check, Clipboard, CodeBranch, CommentDots, Edit, FileAlt, History, InfoCircle, Key, Link, ShieldAlt, Sitemap, Star, User, Wrench } from '@/components/atoms/icon/icons';
import { AS_PANEL_TITLE, AS_TAG, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { copyText } from '@/utils/copyText';

export type ActiveTab = 'details' | 'context' | 'scoring' | 'history' | 'autofix' | 'codeMap';

/**
 * The tabs this page draws itself. Any other tab is one an edition's
 * `finding.panels` registration adds to the row (host `issue-tabs`) and
 * shows (host `issue-tab-panel`).
 */
const PAGE_TABS: readonly string[] = ['details', 'context', 'scoring', 'history', 'autofix'];

/** The finding types whose rules a `cybedefend-ignore[<code>]` directive silences. */
type InlineIgnorableType = 'sast' | 'iac' | 'cicd';

/**
 * Structured commit metadata extracted from a scanner's per-finding
 * description. Gitleaks in git-history mode emits findings with an enriched
 * description of the form:
 *
 *   Secret detected: <rule name>
 *
 *   Commit: <sha>
 *   Author: <name>
 *   Date: <iso date>
 *   Message: <commit message>
 *
 * We parse that text so the UI can render the commit context as a proper
 * card rather than a raw pre-formatted block.
 */
interface ParsedScannerEvidence {
  commit?: string;
  author?: string;
  date?: string;
  message?: string;
}

function parseScannerEvidence(text: string | null | undefined): ParsedScannerEvidence | null {
  if (!text || typeof text !== 'string') return null;
  const result: ParsedScannerEvidence = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('Commit:')) {
      result.commit = line.slice('Commit:'.length).trim();
    } else if (line.startsWith('Author:')) {
      result.author = line.slice('Author:'.length).trim();
    } else if (line.startsWith('Date:')) {
      result.date = line.slice('Date:'.length).trim();
    } else if (line.startsWith('Message:')) {
      result.message = line.slice('Message:'.length).trim();
    }
  }
  // Only surface the card when we actually parsed at least the commit SHA —
  // without it there is nothing meaningful to link back to.
  return result.commit ? result : null;
}

interface IssueSastIacTemplateProps {
  vulnerability: SastVulnerabilityResult | IacVulnerabilityResult | CicdVulnerabilityResult | SecretVulnerabilityResult;
  showModal: boolean;
  onCloseModal: () => void;
  handleUpdateVulnerability: (data: any) => void;
  handleOpenModal: () => void;
  error?: string | null;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isAiMergeRequestEnabled: boolean;
  isGithubLinked?: boolean;
  isGitlabLinked?: boolean;
  projectId: string;
  onRefreshVulnerability: () => void;
  /**
   * Background refetch used by the reanalysis polling loop. Same effect as
   * `onRefreshVulnerability` but does not flip the parent's `loading` flag,
   * so the page skeleton doesn't flash on every poll tick. Falls back to
   * `onRefreshVulnerability` when the parent doesn't supply a silent variant.
   */
  onSilentRefreshVulnerability?: () => void;
  /**
   * Creation date of the latest scan of this vulnerability's type
   * (null while unknown or while a scan is running). An agent verdict older
   * than it "dates from a previous scan" and gets the re-run banner.
   */
  lastScanAt?: string | null;
  onAutofixSuccess: () => void;
  isProjectParsed?: boolean;
  organizationId?: string;
  /** The Jira and Linear tickets of the project. */
  issueTracking?: IssueTracking;
  /** Rendered inside the quick-view drawer: drop the page chrome (back
   * button, full-height page background) so it sits cleanly in the panel. */
  embedded?: boolean;
}

const IssueSastIacTemplate: React.FC<IssueSastIacTemplateProps> = ({
  vulnerability,
  showModal,
  onCloseModal,
  handleUpdateVulnerability,
  handleOpenModal,
  error,
  activeTab,
  setActiveTab,
  isAiMergeRequestEnabled,
  isGithubLinked,
  isGitlabLinked,
  projectId,
  onRefreshVulnerability,
  onSilentRefreshVulnerability,
  lastScanAt,
  onAutofixSuccess,
  isProjectParsed,
  organizationId,
  issueTracking,
  embedded = false,
}) => {
  const { t } = useTranslation();
  // Tabs an edition's registration adds to the row: the ones it withdrew for
  // this page (its data says the tab cannot be shown, e.g. an older backend).
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);
  const hideTab = (tab: string) =>
    setHiddenTabs((tabs) => (tabs.includes(tab) ? tabs : [...tabs, tab]));
  const hasEditionPanels = useSlotEntries('finding.panels').length > 0;
  // A tab that is gone (withdrawn, or no edition draws it: a deep link in a
  // build without it) leaves the reader on the details. A registration that
  // draws the tab sends the reader back itself when the finding has none.
  useEffect(() => {
    if (PAGE_TABS.includes(activeTab)) return;
    if (!hasEditionPanels || hiddenTabs.includes(activeTab)) setActiveTab('details');
  }, [activeTab, hasEditionPanels, hiddenTabs, setActiveTab]);
  // History-aware back: returns to the list the user came from, or falls
  // back to the matching AppSec list page on a deep link (where -1 would leave
  // the app); without a project, the AppSec home rather than the root.
  const smartBack = useSmartBack(
    projectId
      ? projectPath("appsec", projectId, vulnerability?.vulnerabilityType ?? "sast")
      : productHome("appsec"),
  );

  // Compact, label-style section headings + tighter prose inside the drawer;
  // the full-page layout keeps its larger headings.
  const sectionHeading = embedded
    ? "text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2"
    : "text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-3";
  const sectionProse = embedded
    ? "prose prose-sm dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300"
    : "prose dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300";
  // Side blocks (scanner evidence, references, data flow) render as flat
  // sections in the drawer instead of bordered cards to cut visual noise.
  const box = embedded
    ? ""
    : "rounded-2xl p-4 bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line";
  // Live CVSS for the compact header — same source/version logic as the lists
  // and the Scoring tab (env-adjusted v4 → base v4 → CVSS 3.1 fallback).
  const cvss = pickCvssForTable({
    cvss4BaseScore: vulnerability.cvss4BaseScore,
    cvss4EnvironmentalScore: vulnerability.cvss4EnvironmentalScore,
    cvss3BaseScore: (vulnerability.vulnerability as { cvss3?: { baseScore?: string | number } })?.cvss3?.baseScore,
  });
  const cvssScore = cvss.score;
  const cvssVersionLabel = cvss.version === 'v4' ? '4.0' : '3.1';
  // The branch the finding was detected on, which decides the ticket tools offered.
  const findingBranch = (vulnerability as { branch?: string }).branch;

  const inlineIgnorableType: InlineIgnorableType | null = (() => {
    const type = vulnerability?.vulnerabilityType;
    return type === 'sast' || type === 'iac' || type === 'cicd' ? type : null;
  })();
  // What an edition's `finding.panels` registrations of this page read: its
  // tabs, the latest scan of the finding's type, and the background refetch
  // (the parent's silent variant, so the skeleton does not flash).
  const findingPanels = {
    projectId,
    vulnerability,
    vulnerabilityType: vulnerability?.vulnerabilityType,
    lastScanAt,
    onRefresh: onSilentRefreshVulnerability ?? onRefreshVulnerability,
    embedded,
    tabs: { active: activeTab, select: (tab: string) => setActiveTab(tab as ActiveTab), hidden: hiddenTabs, hide: hideTab },
  };

  if (error) {
    return (
      <NotFoundElement
        title={t('pages.issuePage.noVulnerabilityTitle')}
        description={t('pages.issuePage.noVulnerabilityDescription')}
        buttonText={t('common.back')}
        onShowAll={smartBack}
      />
    );
  }

  // Safety check: ensure vulnerability.vulnerability exists
  if (!vulnerability?.vulnerability) {
    return (
      <NotFoundElement
        title={t('pages.issuePage.noVulnerabilityTitle')}
        description={t('pages.issuePage.noVulnerabilityDescription')}
        buttonText={t('common.back')}
        onShowAll={smartBack}
      />
    );
  }

  const severity = vulnerability.currentSeverity
    ? (vulnerability.currentSeverity.toLowerCase() as "low" | "medium" | "high" | "critical" | "fixed")
    : "low";

  // A `cybedefend-ignore[<code>]` directive silences SAST, IaC and
  // CI/CD rules, never a secret — hence the sast/iac/cicd gate above.
  const ruleCode = inlineIgnorableType ? vulnerability.vulnerability.code : undefined;

  const mainCodeSnippet = vulnerability.codeSnippets?.[0] || {
    code: [], language: "", vulnerableStartLine: 0, vulnerableEndLine: 0, startLine: 0,
  };
  const highlightedLines = Array.from({ length: mainCodeSnippet.vulnerableEndLine - mainCodeSnippet.vulnerableStartLine + 1 }, (_, i) => mainCodeSnippet.vulnerableStartLine + i);

  const TabButton: React.FC<{ tabName: ActiveTab; label: string; icon: any }> = ({ tabName, label, icon }) => (
    <IssueTabButton
      tabName={tabName}
      label={label}
      icon={icon}
      activeTab={activeTab}
      onSelect={(tab) => setActiveTab(tab as ActiveTab)}
      embedded={embedded}
    />
  );

  // Helper function to get correct language based on file extension
  const getDisplayLanguage = () => {
    const language = vulnerability.vulnerability.language?.toLowerCase() || '';
    const path = vulnerability.path || '';
    const extension = path.split('.').pop()?.toLowerCase() || '';

    // If language is javascript but file extension is .ts or .tsx, show TypeScript
    if ((language === 'javascript' || language === 'js') && (extension === 'ts' || extension === 'tsx')) {
      return 'TypeScript';
    }
    // If language is javascript and file extension is .jsx, show JavaScript (React)
    if ((language === 'javascript' || language === 'js') && extension === 'jsx') {
      return 'JavaScript (React)';
    }
    // If file extension is .tsx, always show TypeScript (React)
    if (extension === 'tsx') {
      return 'TypeScript (React)';
    }
    // If file extension is .ts, always show TypeScript
    if (extension === 'ts' && language !== 'typescript') {
      return 'TypeScript';
    }
    return vulnerability.vulnerability.language || '';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(embedded ? "" : "mx-auto px-4 py-6 min-h-screen bg-zinc-50 dark:bg-as-bg")}
    >
      {!embedded && (
        <div className="mb-4">
          <BackButton text={t('components.analyseWrapper.backToVulnerabilities')} onClick={smartBack} />
        </div>
      )}

      <Card
        padding={embedded ? "none" : undefined}
        className={cn(
          "rounded-2xl",
          embedded && "!rounded-none !border-0 !bg-transparent !shadow-none",
        )}
      >
        <div className={cn(embedded ? "p-4" : "p-4 sm:p-6")}>
          {/* On the full page the actions sit beside the title only where there
              is room for both (`lg`); below, they go under it, as in the drawer. */}
          <div className={cn("mb-4 flex flex-col gap-3", !embedded && "lg:flex-row lg:justify-between lg:items-start")}>
            <div className="flex items-start flex-1 min-w-0">
              <SeverityBadge severity={severity} />
              <div className="ml-4 min-w-0">
                {/* Dark theme */}
                <h1 className={cn("font-semibold tracking-[-0.02em] text-zinc-900 dark:text-zinc-50 break-words", embedded ? "text-lg leading-snug" : "text-xl sm:text-2xl")}>{vulnerability.vulnerability.name}</h1>
                {embedded ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {getDisplayLanguage() && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-md bg-zinc-100 dark:bg-as-raised text-zinc-600 dark:text-zinc-300">
                        <LanguageLogo language={getDisplayLanguage()} className="w-3.5 h-3.5 shrink-0" />
                        {getDisplayLanguage()}
                      </span>
                    )}
                    {vulnerability.vulnerability.cwe?.map((cwe) => (
                      <a key={cwe} href={`https://cwe.mitre.org/data/definitions/${cwe.split("-")[1]}.html`} target="_blank" rel="noopener noreferrer" className={cn('relative transition-colors', AS_TAG, 'text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100', AS_TOUCH)}>
                        {cwe}
                      </a>
                    ))}
                    {ruleCode && <RuleCodeDirective code={ruleCode} filePath={vulnerability.path} />}
                  </div>
                ) : (
                  <>
                    <p className={cn("text-sm text-zinc-500 dark:text-zinc-400 mt-1")}>
                      {/* Language then CWEs as one list with commas (no pipe); links in zinc, underlined on hover. */}
                      {getDisplayLanguage()}
                      {vulnerability.vulnerability.cwe?.map((cwe, index) => (
                        <React.Fragment key={cwe}>
                          {index > 0 || getDisplayLanguage() ? ', ' : ''}
                          <a href={`https://cwe.mitre.org/data/definitions/${cwe.split("-")[1]}.html`} target="_blank" rel="noopener noreferrer" className={cn("text-zinc-700 hover:text-zinc-900 hover:underline dark:text-zinc-300 dark:hover:text-zinc-100")}>
                            {cwe}
                          </a>
                        </React.Fragment>
                      ))}
                    </p>
                    {ruleCode && (
                      <div className="mt-2">
                        <RuleCodeDirective code={ruleCode} filePath={vulnerability.path} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className={cn(!embedded && "lg:flex-shrink-0")}>
              {/* Up to four actions, one of them a sentence: the row wraps
                  rather than push the page sideways. */}
              <div className={cn("flex flex-wrap", embedded ? "gap-2" : "gap-3")}>
                {/* The AutoFix button — for SAST/IAC/CICD findings when the AI
                    merge request is enabled and the project is linked to GitHub
                    or GitLab, and no record produced a fix — is a
                    `finding.actions` registration of the active edition: it owns those
                    conditions now. */}
                <Slot
                  name="finding.actions"
                  context={{ projectId, vulnerability, vulnerabilityType: vulnerability?.vulnerabilityType, host: 'issue-actions' }}
                />
                {issueTracking && (
                  // Only the tools whose project settings allow the finding's branch.
                  <TicketTracker
                    tracking={trackingForBranch(issueTracking, findingBranch)}
                    projectId={projectId}
                    groupName={vulnerability.vulnerability.name}
                    occurrenceIds={[vulnerability.id]}
                    vulnerabilities={[{
                      vulnerabilityId: vulnerability.id,
                      scannerType: vulnerability.vulnerabilityType,
                      severity: vulnerability.severity || "medium",
                      name: vulnerability.vulnerability.name,
                      shortDescription: vulnerability.vulnerability.shortDescription,
                      filePath: (vulnerability as any).vulnerability?.filePath,
                      startLine: (vulnerability as any).vulnerability?.startLine,
                      cwe: vulnerability.vulnerability.cwe,
                      branch: findingBranch,
                    }]}
                  />
                )}
                {vulnerability.vulnerabilityType === 'secret' &&
                  vulnerability.currentState !== 'resolved' && (
                    <MarkAsRotatedButton
                      projectId={projectId}
                      vulnerabilityId={vulnerability.id}
                      onSuccess={onRefreshVulnerability}
                    />
                  )}
                {/* What the active edition adds after the finding's own actions
                    (`host: 'issue-actions-trailing'`): nothing in a community build. */}
                <Slot
                  name="finding.actions"
                  context={{ projectId, organizationId, findingId: vulnerability.id, vulnerabilityType: vulnerability.vulnerabilityType, host: 'issue-actions-trailing' }}
                />
                <Button variant="secondary" icon={<Edit className="h-4 w-4"  />} onClick={handleOpenModal}>{t('pages.issuePage.updateIssue')}</Button>
              </div>
            </div>
          </div>
          {/* Dark theme */}
          <dl className={cn(
            "grid bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-as-line",
            embedded
              ? "grid-cols-2 gap-3 p-3 rounded-xl"
              : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-2xl"
          )}>
            <div className={cn("flex items-center", embedded && "col-span-2 min-w-0")}>
              <FileAlt className="h-4 w-4 text-zinc-400 dark:text-zinc-500 mr-3 flex-shrink-0"  />
              <div className="min-w-0">
                <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('common.file')}</dt>
                <dd
                  className={cn("text-sm font-mono text-zinc-700 dark:text-zinc-300", embedded ? "truncate" : "break-all")}
                  // Left-truncate (rtl) inside the drawer so the filename — the
                  // useful end of the path — stays visible. Matches the path
                  // rendering used in the results tables.
                  style={embedded ? { direction: "rtl", textAlign: "left" } : undefined}
                  title={vulnerability.path}
                >
                  {vulnerability.path}
                </dd>
              </div>
            </div>
            {embedded && cvssScore != null && (
              <div className="flex items-center">
                <ShieldAlt className={cn("mr-3 flex-shrink-0", cvssScoreColorClass(cvssScore))}  />
                <div>
                  <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>CVSS {cvssVersionLabel}</dt>
                  <dd className={cn("text-sm font-semibold", cvssScoreColorClass(cvssScore))}>{cvssScore}</dd>
                </div>
              </div>
            )}
            <div className="flex items-center">
              <AlertTriangle className="h-4 w-4 text-zinc-400 dark:text-zinc-500 mr-3"  />
              <div>
                <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('common.priority')}</dt>
                <dd className="text-sm"><SeverityChip level={priorityChipLevel(vulnerability.currentPriority)}>{getPriorityLabel(vulnerability.currentPriority)}</SeverityChip></dd>
              </div>
            </div>
            <div className="flex items-center">
              <InfoCircle className="h-4 w-4 text-zinc-400 dark:text-zinc-500 mr-3"  />
              <div>
                <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('common.status')}</dt>
                <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{getStatusLabel(vulnerability.currentState)}</dd>
              </div>
            </div>
            <ExploitabilityMetaTile verdict={vulnerability.exploitabilityVerdict} />
          </dl>
        </div>

        {/* The analysis of the finding — the banner of an analysis older than
            the latest scan or the security context, with its re-run, and the
            analysis indicator — is a `finding.panels` registration of the
            active edition. */}
        <Slot name="finding.panels" context={{ ...findingPanels, host: 'issue-analysis' }} />

        {mainCodeSnippet.code && mainCodeSnippet.code.length > 0 ? (
          <div className={cn("px-4 sm:px-6 mb-6")}>
            <h3 className={cn(sectionHeading)}>{t('pages.issuePage.tabs.vulnerableCode')}</h3>
            <CodeSnippet code={mainCodeSnippet.code} language={mainCodeSnippet.language} highlightedLines={highlightedLines} showLineNumbers={true} startingLineNumber={mainCodeSnippet.startLine} />
          </div>
        ) : vulnerability.vulnerabilityType === 'secret' && (vulnerability as SecretVulnerabilityResult).source === 'history' ? (
          <div className={cn("px-4 sm:px-6 mb-6")}>
            <h3 className={cn(sectionHeading)}>{t('pages.issuePage.tabs.vulnerableCode')}</h3>
            <div className={cn("flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700")}>
              <History className="h-5 w-5 text-amber-500 mt-0.5"  />
              <p className={cn("text-sm text-amber-800 dark:text-amber-200")}>{t('pages.issuePage.tabs.secretDetectedInHistory')}</p>
            </div>
          </div>
        ) : null}

        {vulnerability.vulnerabilityType === 'secret' && (
          <div className="px-4 sm:px-6 mb-6">
            <SecretRevealCard
              projectId={projectId}
              vulnerabilityId={vulnerability.id}
              hasStoredValue={(vulnerability as any).hasEncryptedSecret ?? false}
            />
          </div>
        )}

        {/* Remove AutoFix Display from here - it will be in its own tab */}

        <div className={cn("border-t border-zinc-200 dark:border-as-line")}>
          <div className={cn("border-b border-zinc-200 dark:border-as-line px-4")}>
            <nav className={cn("flex", embedded ? "flex-nowrap gap-x-2 overflow-x-auto overflow-y-hidden scrollbar-hide" : "flex-wrap gap-x-6 gap-y-1")} aria-label="Tabs">
              <TabButton tabName="details" label={t('pages.issuePage.tabs.detailsAndFix')} icon={Bug} />
              <TabButton tabName="scoring" label={t('pages.issuePage.scoring.tabTitle')} icon={Star} />
              {/* AutoFix tab — only when AI corrections exist. Sits after the
                  two analysis tabs rather than splitting them. */}
              {vulnerability.autofixRecords && vulnerability.autofixRecords.length > 0 && (
                <TabButton tabName="autofix" label={t('pages.issuePage.tabs.corrections')} icon={Wrench} />
              )}
              {/* Tabs an edition adds (the code map). */}
              <Slot name="finding.panels" context={{ ...findingPanels, host: 'issue-tabs' }} />
              <TabButton tabName="history" label={t('pages.issuePage.tabs.history')} icon={History} />
            </nav>
          </div>

          <div className={cn(embedded ? "p-4" : "p-4 sm:p-6")}>
            <AnimatePresence mode="wait">
              {activeTab === 'details' && (
                <motion.div
                  key="details"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className={cn("grid", embedded ? "grid-cols-1 gap-4" : "grid-cols-1 lg:grid-cols-2 gap-8")}
                >
                  <Slot name="finding.actions" context={{ projectId, vulnerability, vulnerabilityType: vulnerability?.vulnerabilityType }}>
                  <div>
                    <h3 className={cn(sectionHeading)}>{t('pages.issuePage.whyVulnerability')}</h3>
                    <div className={cn(sectionProse, embedded ? "mb-5" : "mb-8")}>
                      <SafeMarkdown content={vulnerability.vulnerability.description ?? ""} linkTone="accent" />
                    </div>
                    <h3 className={cn(sectionHeading)}>{t('pages.issuePage.howToPrevent')}</h3>
                    <div className={cn(sectionProse)}>
                      <SafeMarkdown content={vulnerability.vulnerability.howToPrevent ?? ""} linkTone="accent" />
                    </div>
                  </div>
                  </Slot>
                  <div className={cn(embedded ? "space-y-5" : "space-y-6")}>
                    {/* In the drawer the CVSS card is redundant with the
                        Scoring & Exploitability tab, so it's hidden there. */}
                    {!embedded && <CvssScoreCard vulnerability={vulnerability} />}
                    {(() => {
                      const evidence = parseScannerEvidence(vulnerability.contextualExplanation);
                      if (!evidence) return null;
                      let formattedDate: string | null = null;
                      if (evidence.date) {
                        const parsed = new Date(evidence.date);
                        if (!isNaN(parsed.getTime())) {
                          formattedDate = parsed.toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          });
                        }
                      }
                      return (
                        <div className={cn(box)}>
                          <h4 className={cn("font-medium text-zinc-800 dark:text-zinc-200 mb-3 text-sm flex items-center")}>
                            <CodeBranch className={cn("mr-2 text-secondary dark:text-secondary-light")}  /> {t('pages.issuePage.scannerEvidence')}
                          </h4>
                          <div className={cn("space-y-2.5 text-sm")}>
                            {evidence.commit && (
                              <div className={cn("flex items-start gap-2")}>
                                <CodeBranch className={cn("mt-1 w-5 text-zinc-400 dark:text-zinc-500 shrink-0")}  />
                                <div className={cn("min-w-0 flex-1")}>
                                  <div className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.scannerEvidenceCommit')}</div>
                                  <code className={cn("font-mono text-xs bg-zinc-100 dark:bg-as-raised px-1.5 py-0.5 rounded text-zinc-700 dark:text-zinc-200 break-all")} title={evidence.commit}>
                                    {evidence.commit.substring(0, 12)}
                                  </code>
                                </div>
                              </div>
                            )}
                            {evidence.author && (
                              <div className={cn("flex items-start gap-2")}>
                                <User className={cn("mt-1 w-5 text-zinc-400 dark:text-zinc-500 shrink-0")}  />
                                <div className={cn("min-w-0 flex-1")}>
                                  <div className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.scannerEvidenceAuthor')}</div>
                                  <div className={cn("text-zinc-700 dark:text-zinc-200 truncate")} title={evidence.author}>{evidence.author}</div>
                                </div>
                              </div>
                            )}
                            {formattedDate && (
                              <div className={cn("flex items-start gap-2")}>
                                <CalendarAlt className={cn("mt-1 w-5 text-zinc-400 dark:text-zinc-500 shrink-0")}  />
                                <div className={cn("min-w-0 flex-1")}>
                                  <div className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.scannerEvidenceDate')}</div>
                                  <time dateTime={evidence.date} className={cn("text-zinc-700 dark:text-zinc-200")}>{formattedDate}</time>
                                </div>
                              </div>
                            )}
                            {evidence.message && (
                              <div className={cn("flex items-start gap-2")}>
                                <CommentDots className={cn("mt-1 w-5 text-zinc-400 dark:text-zinc-500 shrink-0")}  />
                                <div className={cn("min-w-0 flex-1")}>
                                  <div className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.scannerEvidenceMessage')}</div>
                                  <div className={cn("text-zinc-700 dark:text-zinc-200 italic break-words")}>&ldquo;{evidence.message}&rdquo;</div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {vulnerability.vulnerability.references && vulnerability.vulnerability.references.length > 0 && (
                      <div className={cn(box)}>
                        <h4 className={cn("font-medium text-zinc-800 dark:text-zinc-200 mb-3 text-sm flex items-center")}>
                          <Link className={cn("mr-2 text-secondary dark:text-secondary-light")}  /> {t('pages.issuePage.sast.references')}
                        </h4>
                        <ul className={cn("space-y-2")}>
                          {vulnerability.vulnerability.references.map(ref => (
                            <li key={ref.id} className="text-sm truncate">
                              <a href={ref.url} target="_blank" rel="noopener noreferrer" className={cn("text-secondary dark:text-secondary-light hover:underline")}>{ref.name || ref.url}</a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {vulnerability.vulnerabilityType === 'sast' && vulnerability.dataFlowItems && vulnerability.dataFlowItems.length > 0 && (
                      <div className={cn(box)}>
                        <h4 className={cn("font-medium text-zinc-800 dark:text-zinc-200 mb-3 text-sm flex items-center")}>
                          <Sitemap className={cn("mr-2 text-zinc-500 dark:text-zinc-400")}  /> Data Flow
                        </h4>
                        <DataFlow dataFlowItems={vulnerability.dataFlowItems} />
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* {activeTab === 'context' && (
              <div className="space-y-8">
                {vulnerability.vulnerability.codeExamples && vulnerability.vulnerability.codeExamples.length > 0 ? (
                  <div>
                    <h3 className="text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-3">{t('pages.issuePage.sast.codeExamples')}</h3>
                    {vulnerability.vulnerability.codeExamples.map((example, index) => (
                      // The dedicated component
                      <CodeExampleViewer key={index} filename={example.filename} content={example.content} />
                    ))}
                  </div>
                ) : (
                  <NotFoundElement title={t('pages.issuePage.tabs.noCodeExamplesTitle')} description={t('pages.issuePage.tabs.noCodeExamplesDescription')} />
                )}
              </div>
            )} */}

              {activeTab === 'scoring' && (
                <motion.div
                  key="scoring"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <ScoringExploitabilityTab vulnerability={vulnerability} projectId={projectId} embedded={embedded} />
                </motion.div>
              )}

              {activeTab === 'history' && (
                <motion.div
                  key="history"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <Slot name="finding.actions" context={{ projectId, vulnerability, vulnerabilityType: vulnerability?.vulnerabilityType }}>
                    {vulnerability.historyItems && Array.isArray(vulnerability.historyItems) && vulnerability.historyItems.length > 0
                      ? <HistoryTimeline historyItems={vulnerability.historyItems} />
                      : <NotFoundElement title={t('pages.issuePage.tabs.noHistoryTitle')} description={t('pages.issuePage.tabs.noHistoryDescription')} />}
                  </Slot>
                </motion.div>
              )}

              {/* The panel of a tab an edition adds: its registration draws it. */}
              {!PAGE_TABS.includes(activeTab) && (
                <Slot key={`edition:${activeTab}`} name="finding.panels" context={{ ...findingPanels, host: 'issue-tab-panel' }} />
              )}

              {activeTab === 'autofix' && (
                <motion.div
                  key="autofix"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {vulnerability.autofixRecords && vulnerability.autofixRecords.length > 0
                    ? // The corrections panel is a `finding.panels` registration
                      // of the active edition.
                      <Slot name="finding.panels" context={{ projectId, vulnerability, vulnerabilityType: vulnerability?.vulnerabilityType, host: 'issue-autofix' }} />
                    : <NotFoundElement title={t('pages.issuePage.autofix.noAutofixTitle')} description={t('pages.issuePage.autofix.noAutofixDescription')} />}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </Card>

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <UpdateVulnerabilityModal
              onClose={onCloseModal}
              onSubmit={handleUpdateVulnerability}
              currentStatus={vulnerability.currentState}
              currentPriority={vulnerability.currentPriority}
              currentExploitabilityVerdict={vulnerability.exploitabilityVerdict}
            />
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
};

// ---------------------------------------------------------------------------
// RuleCodeDirective — internal component
// ---------------------------------------------------------------------------

interface RuleCodeDirectiveProps {
  code: string;
  filePath?: string;
}

/**
 * The catalogue rule code (`CD-<TYPE>-<NNNN>`) and a button that copies the
 * `cybedefend-ignore[<code>]: <reason>` directive in the comment syntax of the
 * finding's file, ready to paste on the flagged line or the line above it.
 */
const RuleCodeDirective: React.FC<RuleCodeDirectiveProps> = ({ code, filePath }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (await copyText(buildIgnoreDirective(code, filePath))) {
      setCopied(true);
      toast.success(t('pages.issuePage.ruleCode.directiveCopied'));
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(t('pages.issuePage.ruleCode.copyFailed'));
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <code
        data-testid="rule-code"
        title={t('pages.issuePage.ruleCode.label')}
        className="px-2 py-0.5 text-xs font-mono rounded-md bg-zinc-100 dark:bg-as-raised text-zinc-700 dark:text-zinc-200"
      >
        <span className="sr-only">{t('pages.issuePage.ruleCode.label')} </span>
        {code}
      </code>
      <Button
        variant="ghost"
        size="xs"
        onClick={handleCopy}
        data-testid="copy-ignore-directive-button"
        title={t('pages.issuePage.ruleCode.tooltip')}
        icon={copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Clipboard className="w-3.5 h-3.5" />}
        className="py-0.5 rounded-md text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:text-zinc-100 dark:hover:bg-white/[0.06]"
      >
        {t('pages.issuePage.ruleCode.copyDirective')}
      </Button>
    </span>
  );
};

// ---------------------------------------------------------------------------
// MarkAsRotatedButton — internal component
// ---------------------------------------------------------------------------

interface MarkAsRotatedButtonProps {
  projectId: string;
  vulnerabilityId: string;
  onSuccess: () => void;
}

const MarkAsRotatedButton: React.FC<MarkAsRotatedButtonProps> = ({
  projectId,
  vulnerabilityId,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const { rotate, loading } = useRotateSecret(projectId, vulnerabilityId);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleConfirm = async () => {
    const success = await rotate();
    if (success) {
      setShowConfirm(false);
      onSuccess();
    }
  };

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className={cn(
          'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg font-medium',
          'bg-amber-50 dark:bg-amber-900/20',
          'text-amber-700 dark:text-amber-300',
          'border border-amber-200 dark:border-amber-700/50',
          'hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors',
        )}
      >
        <Key className="h-5 w-5"  />
        {t('pages.issuePage.markAsRotated')}
      </button>

      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowConfirm(false)}
        >
          <div
            className={cn(
              'relative w-full max-w-md mx-4 p-6 rounded-xl',
              'bg-white dark:bg-as-surface',
              'border border-zinc-200 dark:border-as-line-strong',
              'shadow-[0_24px_48px_-16px_rgb(0_0_0/0.18)]',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={cn(AS_PANEL_TITLE, 'mb-2')}>
              {t('pages.issuePage.markAsRotatedConfirm.title')}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
              {t('pages.issuePage.markAsRotatedConfirm.body')}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className={cn(
                  'px-4 py-2 text-sm rounded-lg',
                  'bg-zinc-100 dark:bg-as-raised',
                  'text-zinc-700 dark:text-zinc-300',
                  'hover:bg-zinc-200 dark:hover:bg-white/[0.09] transition-colors',
                )}
              >
                {t('pages.issuePage.markAsRotatedConfirm.cancel')}
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className={cn(
                  'px-4 py-2 text-sm rounded-lg font-medium',
                  'bg-amber-600 text-white',
                  'hover:bg-amber-700 transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {loading ? '…' : t('pages.issuePage.markAsRotatedConfirm.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default IssueSastIacTemplate;