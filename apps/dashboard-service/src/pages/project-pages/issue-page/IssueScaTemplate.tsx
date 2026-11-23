import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import SafeMarkdown from '@/components/atoms/safe-markdown/SafeMarkdown';
import { motion, AnimatePresence } from "framer-motion";

import PackageTypeBadge from "../../../components/atoms/badge/PackageTypeBadge";
import EcosystemLogo from "../../../components/atoms/ecosystem-logo/EcosystemLogo";
import SeverityBadge from "../../../components/atoms/badge/SeverityBadge";
import SeverityChip, { priorityChipLevel } from '@/components/atoms/badge/SeverityChip';
import BackButton from "../../../components/atoms/button/BackButton";
import useSmartBack from "../../../server/hooks/useSmartBack";
import { productHome, projectPath } from "@/utils/product";
import Button from "../../../components/atoms/button/Button";
import Card from "../../../components/atoms/card/Card";
import HistoryTimeline from "../../../components/molecules/issue/history-timeline/HistoryTimeline";
import UpdateVulnerabilityModal from "../../../components/molecules/modal/update-vulnerability-modal/UpdateVulnerabilityModal";
import NotFoundElement from "../../../components/molecules/not-found-element/NotFoundElement";
import TicketTracker from "../../../components/molecules/ticket-tracker/TicketTracker";
import { trackingForBranch, type IssueTracking } from "../../../server/hooks/useIssueTracking";
import { Slot } from "@/edition/slots";
import { EDITION } from "@/edition/edition";

import ScoringExploitabilityTab from "@/components/molecules/scoring/ScoringExploitabilityTab";
import ExploitabilityMetaTile from "@/components/molecules/issue/exploitability-meta-tile/ExploitabilityMetaTile";

import {
  cn,
  convertDate,
  getPriorityLabel,
  getStatusLabel,
} from "../../../utils/function/utils";

import type {
  ScaVulnerabilityResult,
  VulnerabilityScaAlias,
  VulnerabilityScaCwe,
  VulnerabilityScaPackage,
  VulnerabilityScaReference,
  VulnerabilityScaSeverity,
} from "../../../server/interfaces/Vulnerability";
import { AlertTriangle, AngleDown, AngleLeft, AngleRight, AngleUp, Box, BoxOpen, Bug, CalendarAlt, CheckCircle, Circle, CodeBranch, Edit, FileCode, FolderTree, History, InfoCircle, Link, ShieldAlt, Star, Tag, TimesCircle, Tools } from '@/components/atoms/icon/icons';
import { AS_FOCUS_INSET, AS_TAG, AS_TD, AS_TH, AS_TOUCH } from '@/components/atoms/appsec/styles';

export type ScaActiveTab = 'details' | 'scoring' | 'history';

/** A SARIF import carries no dependency analysis and no dependency path: the
 * reachability row and the dependency tree are not rendered in the Community Edition. */
const SCANNER_ONLY_HIDDEN = EDITION === 'community';

/**********************************************************
 * pickLatestCvss : If we have multiple "CVSS" versions (e.g. v3, v4),
 * return the one with the highest version number => v4 > v3 > v2
 **********************************************************/
function pickLatestCvss(
  severities: VulnerabilityScaSeverity[]
): VulnerabilityScaSeverity | null {
  const getVersion = (type: string): number => {
    const match = type.toUpperCase().match(/CVSS[_-]?V?(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };
  let best: VulnerabilityScaSeverity | null = null;
  for (const s of severities) {
    if (!s.type.toUpperCase().includes("CVSS")) continue;
    if (!best || getVersion(s.type) > getVersion(best.type)) {
      best = s;
    }
  }
  return best;
}

/**********************************************************
 * DependencyTreeNode component renders a single node in the dependency tree
 **********************************************************/
interface DependencyTreeNodeProps {
  name: string;
  isLast: boolean;
  isExpanded?: boolean;
  depth?: number;
  hasChildren?: boolean;
  onToggle?: () => void;
}

const DependencyTreeNode: React.FC<DependencyTreeNodeProps> = ({
  name,
  isLast,
  isExpanded = true,
  depth = 0,
  hasChildren = false,
  onToggle,
}) => {
  const indentation = 16; // pixels per level

  return (
    <div
      className={cn(
        "flex items-center py-1.5 transition-colors duration-150 rounded-md px-2",
        "hover:bg-zinc-50 dark:hover:bg-white/[0.06]"
      )}
      style={{ paddingLeft: `${(depth * indentation) + 8}px` }}
    >
      {hasChildren ? (
        <button
          onClick={onToggle}
          className={cn(
            "mr-2 focus:outline-none rounded-full p-1 transition-colors duration-150",
            "hover:bg-zinc-200 dark:hover:bg-white/[0.09]"
          )}
        >
          {isExpanded ? <AngleDown
            className={cn("text-secondary dark:text-secondary-light w-4.5 h-4.5")} /> : <AngleRight
            className={cn("text-secondary dark:text-secondary-light w-4.5 h-4.5")} />}
        </button>
      ) : (
        <span className="mr-2 ml-1 w-3 h-3 flex items-center justify-center">
          <Circle
            className={cn("text-zinc-300 dark:text-zinc-500 w-1.5 h-1.5")}
           />
        </span>
      )}

      {isLast ? <BoxOpen
        className={cn(
          "mr-2",
          isLast ? 'text-high-risk' : 'text-secondary dark:text-secondary-light'
        )} /> : <FolderTree
        className={cn(
          "mr-2",
          isLast ? 'text-high-risk' : 'text-secondary dark:text-secondary-light'
        )} />}

      <span className={cn(
        "text-sm font-medium break-all",
        isLast ? 'text-high-risk font-semibold' : 'text-zinc-700 dark:text-zinc-300'
      )}>
        {name}
      </span>
    </div>
  );
};

/**********************************************************
 * DependencyTree component to visualize package dependencies
 **********************************************************/
interface DependencyTreeProps {
  path: string[];
  packageName: string;
}

const DependencyTree: React.FC<DependencyTreeProps> = ({ path, packageName }) => {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>(
    Object.fromEntries(path.map((_, i) => [i.toString(), true]))
  );
  const { t } = useTranslation();

  const toggleNode = (index: number) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [index.toString()]: !prev[index.toString()],
    }));
  };

  // Invert the path to show the correct dependency direction (your project → vulnerable package)
  // We start from your project and go towards the vulnerable package
  const invertedPath = [...path].reverse();

  return (
    <div className={cn(
      "rounded-2xl p-4",
      "border bg-white dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]"
    )}>
      <h3 className={cn("text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-3 flex items-center")}>
        <CodeBranch className={cn("mr-2 text-secondary dark:text-secondary-light")}  />
        {t('pages.issuePage.dependencyPath')}
      </h3>
      <div className={cn("border rounded-2xl overflow-hidden bg-zinc-50 dark:bg-white/[0.03]")}>
        {/* Your project node (root) */}
        <div className={cn("flex items-center py-1.5 bg-zinc-100 dark:bg-white/[0.1] px-2")}>
          <FolderTree
            className={cn("mr-2 text-secondary dark:text-secondary-light")}
           />
          <span className={cn("text-sm font-medium text-zinc-700 dark:text-zinc-300")}>
            Your Project
          </span>
        </div>

        {/* Dependency path nodes */}
        {invertedPath.map((dep, index) => {
          const depth = index + 1;
          const isExpandable = index < invertedPath.length - 1;
          const isExpanded = expandedNodes[index.toString()];
          const shouldRender = invertedPath.slice(0, index).every(
            (_, i) => expandedNodes[i.toString()]
          );

          if (!shouldRender) return null;

          return (
            <DependencyTreeNode
              key={`${index}-${dep}`}
              name={dep}
              isLast={false}
              isExpanded={isExpanded}
              depth={depth}
              hasChildren={isExpandable}
              onToggle={() => toggleNode(index)}
            />
          );
        })}

        {/* Vulnerable package (leaf node) */}
        <DependencyTreeNode
          key="vulnerable-package"
          name={packageName}
          isLast={true}
          depth={invertedPath.length + 1}
          hasChildren={false}
        />
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 italic">
        {t('pages.issuePage.dependencyPathDescription')}
      </p>
    </div>
  );
};

/**********************************************************
 * MetadataSection component for displaying vulnerability metadata
 **********************************************************/
interface MetadataSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

const MetadataSection: React.FC<MetadataSectionProps> = ({
  title,
  icon,
  children
}) => {
  return (
    <div className={cn(
      "p-4 rounded-2xl mb-4",
      "bg-white dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]",
      "border dark:border-as-line"
    )}>
      <h3 className={cn("text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-3 flex items-center")}>
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
};

/**********************************************************
 * PROPS
 **********************************************************/
interface IssueScaTemplateProps {
  vulnerability: ScaVulnerabilityResult;
  showModal: boolean;
  onCloseModal: () => void;
  handleUpdateVulnerability: (data: any) => void;
  handleOpenModal: () => void;
  error?: string | null;
  isProjectParsed?: boolean;
  projectId: string;
  isGithubLinked?: boolean;
  isGitlabLinked?: boolean;
  /** The Jira and Linear tickets of the project. */
  issueTracking?: IssueTracking;
  /** Rendered inside the quick-view drawer: drop the page chrome. */
  embedded?: boolean;
}

/**********************************************************
 * COMPONENT
 **********************************************************/
const IssueScaTemplate: React.FC<IssueScaTemplateProps> = ({
  vulnerability,
  showModal,
  onCloseModal,
  handleUpdateVulnerability,
  handleOpenModal,
  error,
  isProjectParsed,
  projectId,
  isGithubLinked,
  isGitlabLinked,
  issueTracking,
  embedded = false,
}) => {
  const { t } = useTranslation();

  // History-aware back: returns to the list the user came from, or falls
  // back to the AppSec SCA list page on a deep link (where -1 would leave the
  // app); without a project, the AppSec home rather than the root.
  const smartBack = useSmartBack(projectId ? projectPath('appsec', projectId, 'sca') : productHome('appsec'));
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [activeTab, setActiveTab] = useState<ScaActiveTab>('details');
  const [importLocationIndex, setImportLocationIndex] = useState(0);

  // Compact, label-style section headings + tighter prose inside the drawer;
  // the full-page layout keeps its larger headings.
  const sectionHeading = embedded
    ? "text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2 flex items-center"
    : "text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-3 flex items-center";

  // The branch the finding was detected on, which decides the ticket tools offered.
  const findingBranch = (vulnerability as { branch?: string } | null)?.branch;

  if (error) {
    return (
      <NotFoundElement
        title={t('pages.issuePage.noVulnerabilityTitle')}
        description={t('pages.issuePage.scaErrorDescription')}
        buttonText={t('common.back')}
        onShowAll={smartBack}
      />
    );
  }

  if (!vulnerability.vulnerability) {
    return (
      <NotFoundElement
        title={t('pages.issuePage.invalidScaDataTitle')}
        description={t('pages.issuePage.invalidScaDataDescription')}
        buttonText={t('common.back')}
        onShowAll={smartBack}
      />
    );
  }

  const severity =
    (vulnerability.currentSeverity?.toLowerCase() as
      | "low"
      | "medium"
      | "high"
      | "critical"
      | "fixed") || "low";

  const introducedOn = vulnerability.createdAt;
  const scaMeta = vulnerability.vulnerability;
  const scaLib = vulnerability.package;

  // A malicious package (malware) has no CVE and inherently no CVSS,
  // no EPSS and no exploitable-path concept, so those cards/badges are hidden.
  // Everything below is gated on this flag; non-malware SCA findings are
  // rendered exactly as before.
  const isMalware = vulnerability.isMalware === true;

  const scaAliases: VulnerabilityScaAlias[] = scaMeta.aliases || [];
  const scaCwes: VulnerabilityScaCwe[] = scaMeta.cwes || [];
  const scaReferences: VulnerabilityScaReference[] = scaMeta.references || [];
  const scaSeverities: VulnerabilityScaSeverity[] = scaMeta.severities || [];
  const scaPackages: VulnerabilityScaPackage[] = scaMeta.packages || [];

  // Package manager / ecosystem (e.g. "PyPI", "npm") surfaced as a header chip.
  const packageManager = scaLib?.ecosystem || scaPackages[0]?.ecosystem || '';

  const legacyCvssEntry = pickLatestCvss(scaSeverities);
  // Prefer the CVSS 4.0 fields enriched by the backend (same source used by
  // the Scoring tab). Environmental score wins over base when both exist.
  // Fall back to the legacy OSV severity entry + cvssScore for older data.
  const hasCvss4 =
    vulnerability.cvss4BaseScore != null ||
    vulnerability.cvss4EnvironmentalScore != null;
  const cvssBadgeScore = hasCvss4
    ? (vulnerability.cvss4EnvironmentalScore ?? vulnerability.cvss4BaseScore ?? 0)
    : (legacyCvssEntry ? vulnerability.cvssScore : 0);
  const cvssBadgeLabel = hasCvss4
    ? 'CVSS_V4'
    : (legacyCvssEntry ? legacyCvssEntry.type : null);
  const cvssBadgeVector = hasCvss4
    ? (vulnerability.cvss4EnvironmentalVector ?? vulnerability.cvss4Vector ?? '')
    : (legacyCvssEntry ? legacyCvssEntry.score : '');
  // Never surface a CVSS badge for malware (it has no CVSS).
  const showCvssBadge = cvssBadgeLabel != null && !isMalware;

  // Determine severity color for CVSS gauge
  const getCvssColor = (score: number) => {
    if (score >= 9.0) return "bg-critical-risk";
    if (score >= 7.0) return "bg-high-risk";
    if (score >= 4.0) return "bg-medium-risk";
    return "bg-low-risk";
  };

  // Get text color class for CVSS badge
  const getCvssTextColor = (score: number) => {
    if (score >= 9.0) return "text-critical-risk";
    if (score >= 7.0) return "text-high-risk";
    if (score >= 4.0) return "text-medium-risk";
    return "text-low-risk";
  };

  // Get border color for CVSS gauge
  const getCvssBorderColor = (score: number) => {
    if (score >= 9.0) return "border-critical-risk";
    if (score >= 7.0) return "border-high-risk";
    if (score >= 4.0) return "border-medium-risk";
    return "border-low-risk";
  };

  // Tab button component
  const TabButton: React.FC<{ tabName: ScaActiveTab; label: string; icon: any }> = ({ tabName, label, icon }) => (
    <button
      onClick={() => setActiveTab(tabName)}
      className={cn(
        "relative flex h-11 md:h-10 items-center px-0.5 mr-5 text-[13px] font-medium whitespace-nowrap transition-colors duration-[120ms] border-b-2 -mb-px",
        AS_FOCUS_INSET,
        activeTab === tabName
          ? "border-secondary text-zinc-900 dark:text-zinc-50"
          : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-white/[0.2] dark:hover:text-zinc-100"
      )}
    >
      {React.createElement(icon, { className: "h-4 w-4 mr-1.5" })}
      <span>{label}</span>
    </button>
  );

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
        severity={embedded ? undefined : severity}
        padding={embedded ? "none" : undefined}
        className={cn(
          "rounded-2xl",
          embedded && "!rounded-none !border-0 !bg-transparent !shadow-none",
        )}
      >
        {/* Header with title and actions */}
        <div className={cn(embedded ? "p-4" : "p-4 sm:p-6")}>
          <div className={cn("flex justify-between items-start mb-4", embedded && "gap-3")}>
            <div className="flex items-start">
              <SeverityBadge severity={severity} />
              <div className="ml-4">
                <h1 className={cn("font-semibold tracking-[-0.02em] text-zinc-900 dark:text-zinc-50", embedded ? "text-lg leading-snug" : "text-xl sm:text-2xl")}>
                  {scaMeta.cve || scaMeta.id}
                </h1>
                {scaMeta.summary && (
                  <p className={cn("text-sm text-zinc-500 dark:text-zinc-400 mt-1")}>
                    {scaMeta.summary}
                  </p>
                )}
                {/* Compact meta chips (package manager, CWE, aliases) — drawer only, mirrors the SAST/IaC header */}
                {embedded && (packageManager || scaCwes.length > 0 || scaAliases.length > 0) && (
                  <div data-testid="sca-header-meta" className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {packageManager && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-md bg-zinc-100 dark:bg-as-raised text-zinc-600 dark:text-zinc-300">
                        <EcosystemLogo ecosystem={packageManager} className="w-3.5 h-3.5 shrink-0" />
                        {packageManager}
                      </span>
                    )}
                    {scaCwes.map((cwe: VulnerabilityScaCwe) => {
                      const cweNum = cwe.cweId.split("-")[1] || "000";
                      return (
                        <a
                          key={cwe.id}
                          href={`https://cwe.mitre.org/data/definitions/${cweNum}.html`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn('relative transition-colors', AS_TAG, 'text-secondary hover:bg-zinc-100 dark:text-secondary-light dark:hover:bg-white/[0.06]', AS_TOUCH)}
                        >
                          {cwe.cweId}
                        </a>
                      );
                    })}
                    {scaAliases.map((al: VulnerabilityScaAlias) => (
                      <span
                        key={al.id}
                        className="px-2 py-0.5 text-xs rounded-md bg-zinc-100 dark:bg-as-raised text-zinc-600 dark:text-zinc-300"
                      >
                        {al.alias}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex-shrink-0">
              <div className={cn("flex gap-3", embedded ? "flex-col items-end" : "items-center")}>
                {/* CVSS Score Badge */}
                {showCvssBadge && (
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-xl",
                    "bg-zinc-100 dark:bg-as-raised",
                    "border dark:border-as-line"
                  )}>
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center border-2 font-medium text-sm",
                      "bg-white dark:bg-as-raised",
                      getCvssBorderColor(cvssBadgeScore),
                      getCvssTextColor(cvssBadgeScore)
                    )}>
                      {cvssBadgeScore}
                    </div>
                    <div className="text-xs">
                      <div className={cn("font-medium text-zinc-700 dark:text-zinc-300")}>CVSS</div>
                      <div className={cn("text-zinc-500 dark:text-zinc-400")}>{cvssBadgeLabel}</div>
                    </div>
                  </div>
                )}
                {/* Action buttons — stacked below the CVSS badge when embedded (drawer) */}
                <div className={cn("flex items-center gap-3", embedded && "flex-wrap justify-end")}>
                {/* The « Generate fix » button — always offered for SCA when the
                    project is linked to GitHub or GitLab — is a
                    `finding.actions` registration of the active edition. */}
                <Slot
                  name="finding.actions"
                  context={{ projectId, vulnerability, vulnerabilityType: vulnerability?.vulnerabilityType, host: 'issue-actions' }}
                />
                {issueTracking && (
                  // Only the tools whose project settings allow the finding's branch.
                  <TicketTracker
                    tracking={trackingForBranch(issueTracking, findingBranch)}
                    projectId={projectId}
                    groupName={vulnerability.vulnerability?.cve || vulnerability.vulnerability?.summary || "SCA Vulnerability"}
                    occurrenceIds={[vulnerability.id]}
                    vulnerabilities={[{
                      vulnerabilityId: vulnerability.id,
                      scannerType: "sca",
                      severity: vulnerability.currentSeverity || vulnerability.severity || "medium",
                      name: vulnerability.vulnerability?.cve || vulnerability.vulnerability?.summary || "SCA Vulnerability",
                      shortDescription: vulnerability.vulnerability?.summary,
                      packageName: vulnerability.package?.packageName,
                      packageVersion: vulnerability.package?.packageVersion,
                      externalId: vulnerability.vulnerability?.cve,
                      branch: findingBranch,
                    }]}
                  />
                )}
                <Button
                  variant="secondary"
                  icon={<Edit className="h-4 w-4"  />}
                  onClick={handleOpenModal}
                >
                  {t('pages.issuePage.updateIssue')}
                </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Metadata Grid */}
          <dl className={cn(
            "grid bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-as-line",
            embedded
              ? "grid-cols-2 gap-3 p-3 rounded-xl"
              : "grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 p-4 rounded-2xl"
          )}>
            <div className="flex items-center min-w-0">
              <CalendarAlt className="h-4 w-4 text-zinc-400 dark:text-zinc-500 mr-3 shrink-0"  />
              <div className="min-w-0">
                <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.introducedOn')}</dt>
                <dd className={cn("text-sm font-medium text-zinc-900 dark:text-zinc-100")}>{convertDate(introducedOn)}</dd>
              </div>
            </div>
            <div className="flex items-center min-w-0">
              <AlertTriangle className="h-4 w-4 text-zinc-400 dark:text-zinc-500 mr-3 shrink-0"  />
              <div className="min-w-0">
                <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('common.priority')}</dt>
                <dd className="text-sm"><SeverityChip level={priorityChipLevel(vulnerability.currentPriority)}>{getPriorityLabel(vulnerability.currentPriority)}</SeverityChip></dd>
              </div>
            </div>
            <div className="flex items-center min-w-0">
              <InfoCircle className="h-4 w-4 text-zinc-400 dark:text-zinc-500 mr-3 shrink-0"  />
              <div className="min-w-0">
                <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('common.status')}</dt>
                <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{getStatusLabel(vulnerability.currentState)}</dd>
              </div>
            </div>
            {scaLib && (
              <div className="flex items-center min-w-0">
                <Box className="h-4 w-4 text-zinc-400 dark:text-zinc-500 mr-3 shrink-0"  />
                <div className="min-w-0">
                  <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.packageType')}</dt>
                  <dd className={cn("text-sm font-medium text-zinc-900 dark:text-zinc-100")}>
                    <PackageTypeBadge library={scaLib} />
                  </dd>
                </div>
              </div>
            )}
            {!SCANNER_ONLY_HIDDEN && scaLib?.reachability && (
              <div className="flex items-center min-w-0">
                <Link className="h-4 w-4 text-zinc-400 dark:text-zinc-500 mr-3 shrink-0"  />
                <div className="min-w-0">
                  <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.sca.reachability.title')}</dt>
                  <dd className={cn("text-sm font-semibold")}>
                    <span className={cn(
                      "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs font-medium",
                      scaLib.reachability === 'used'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : scaLib.reachability === 'unused'
                          ? 'bg-zinc-100 text-zinc-600 dark:bg-as-raised dark:text-zinc-400'
                          : scaLib.reachability === 'test_only'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                    )}>
                      {scaLib.reachability === 'used' ? t('pages.issuePage.sca.reachability.used')
                        : scaLib.reachability === 'unused' ? t('pages.issuePage.sca.reachability.unused')
                        : scaLib.reachability === 'potentially_used' ? t('pages.issuePage.sca.reachability.potentially_used')
                        : scaLib.reachability === 'test_only' ? t('pages.issuePage.sca.reachability.test_only')
                        : t('pages.issuePage.sca.reachability.unknown')}
                    </span>
                  </dd>
                </div>
              </div>
            )}
            <ExploitabilityMetaTile verdict={vulnerability.exploitabilityVerdict} />
          </dl>
        </div>

        {/* Mobile CVSS score - visible only on small screens */}
        {showCvssBadge && (
          <div className={cn(
            "md:hidden mx-4 sm:mx-6 mb-4 p-4 rounded-2xl flex items-center border-zinc-200",
            "bg-white dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]",
            "border dark:border-as-line"
          )}>
            <div className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center border-4 font-medium text-lg",
              "bg-white dark:bg-as-raised",
              getCvssBorderColor(cvssBadgeScore),
              getCvssTextColor(cvssBadgeScore)
            )}>
              {cvssBadgeScore}
            </div>
            <div className="ml-3">
              <h3 className={cn("text-sm font-medium text-zinc-700 dark:text-zinc-300")}>
                {t('pages.issuePage.cvssScore')} ({cvssBadgeLabel})
              </h3>
              <p className={cn("text-xs text-zinc-500 dark:text-zinc-400 mt-1")}>
                {cvssBadgeVector}
              </p>
            </div>
          </div>
        )}

        {/* The remediation the active edition adds, right after the header
            (the cloud's SCA AutoFix section). */}
        <Slot
          name="finding.sca.remediation"
          context={{ projectId, vulnerability, vulnerabilityType: 'sca', embedded }}
        />

        {/* What an edition adds to the finding's overview (`finding.panels`,
            host `issue-overview`): the Community Edition's line on Cybe
            Analysis. No cloud registration draws at this host. */}
        <div className="px-4 sm:px-6">
          <Slot
            name="finding.panels"
            context={{ projectId, vulnerability, vulnerabilityType: vulnerability?.vulnerabilityType, embedded, host: 'issue-overview' }}
          />
        </div>

        {/* Tabs Navigation */}
        <div className={cn("border-t border-zinc-200 dark:border-as-line")}>
          <div className={cn("border-b border-zinc-200 dark:border-as-line px-4")}>
            <nav className={cn("flex flex-wrap gap-x-6 gap-y-1")} aria-label="Tabs">
              <TabButton tabName="details" label={t('pages.issuePage.tabs.detailsAndFix')} icon={Bug} />
              <TabButton tabName="scoring" label={t('pages.issuePage.scoring.tabTitle')} icon={Star} />
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
                >
                  {/* Fix available information */}
                  {scaPackages.length > 0 && (
                    <div className={cn("mb-6 break-words")}>
                      <h2 className={cn(sectionHeading)}>
                        <Tools className={cn("mr-2 text-secondary dark:text-secondary-light")}  />
                        {t('pages.issuePage.fixInformation')}
                      </h2>

                      <div className={cn("overflow-x-auto rounded-2xl border dark:border-as-line")}>
                        <table className={cn("w-full text-sm text-left text-zinc-600 dark:text-zinc-400 bg-white dark:bg-as-surface")}>
                          <thead className={cn("text-xs bg-zinc-50/70 dark:bg-white/[0.02] text-zinc-700 dark:text-zinc-300")}>
                            <tr>
                              <th scope="col" className={AS_TH}>
                                {t('components.resultsScaPackagesTable.ecosystem')}
                              </th>
                              <th scope="col" className={AS_TH}>
                                {t('pages.issuePage.package')}
                              </th>
                              <th scope="col" className={AS_TH}>
                                {t('pages.issuePage.introduced')}
                              </th>
                              <th scope="col" className={AS_TH}>
                                {t('pages.issuePage.fixed')}
                              </th>
                              <th scope="col" className={cn(AS_TH, 'text-center')}>
                                {t('pages.issuePage.fixAvailable')}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 dark:divide-as-line">
                            {scaPackages.map((p: VulnerabilityScaPackage) => (
                              <tr
                                key={p.id}
                                className="hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors duration-150"
                              >
                                <td className={cn(AS_TD, 'font-medium')}>{p.ecosystem}</td>
                                <td className={cn(AS_TD, 'font-mono')}>{p.packageName}</td>
                                <td className={cn(AS_TD, 'font-mono')}>{p.introduced}</td>
                                <td className={cn(AS_TD, 'font-mono')}>{p.fixed || '-'}</td>
                                <td className={cn(AS_TD, 'text-center')}>
                                  {p.fixAvailable ? (
                                    <span className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs font-medium bg-fixed-bg text-fixed">
                                      <CheckCircle className="h-3.5 w-3.5 mr-1"  />
                                      {t('common.yes')}
                                    </span>
                                  ) : (
                                    <span className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs font-medium bg-critical-risk-bg text-critical-risk">
                                      <TimesCircle className="h-3.5 w-3.5 mr-1"  />
                                      {t('common.no')}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 italic">
                        {t('pages.issuePage.packagesDescription')}
                      </p>
                    </div>
                  )}

                  {/* Dependency Tree + Exploitable Path side by side.
                      "Exploitable Path" is meaningless for a malicious
                      package, so it is hidden for malware and the grid collapses
                      to a single column (the dependency path is still useful).
                      Both come from the cloud's scanner: a SARIF import carries
                      no dependency path and no import location. */}
                  {scaLib && !SCANNER_ONLY_HIDDEN && (
                    <div className={cn("grid gap-4 mb-4 grid-cols-1", !embedded && !isMalware && "lg:grid-cols-2")}>
                      {!SCANNER_ONLY_HIDDEN && vulnerability.package?.path && vulnerability.package?.path.length > 0 && (
                        <DependencyTree
                          path={vulnerability.package?.path}
                          packageName={scaLib.packageName}
                        />
                      )}

                      {/* Exploitable Path */}
                      {!isMalware && (
                      <div className={cn(
                        "rounded-2xl p-4 flex flex-col",
                        "border bg-white dark:bg-as-surface dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]"
                      )}>
                        <h3 className={cn("text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-3 flex items-center")}>
                          <FileCode className={cn("mr-2 text-secondary dark:text-secondary-light")}  />
                          {t('pages.issuePage.sca.exploitablePath.title')}
                        </h3>
                        {scaLib.importLocations && scaLib.importLocations.length > 0 ? (
                          (() => {
                            const locs = scaLib.importLocations!;
                            const idx = Math.min(importLocationIndex, locs.length - 1);
                            const loc = locs[idx];
                            const fileName = loc.file.split('/').pop() || loc.file;
                            const dirPath = loc.file.substring(0, loc.file.length - fileName.length);
                            // For transitive deps, the import is for the parent package, not the vulnerable one
                            let importedPkgName = scaLib.packageName ?? '...';
                            if (scaLib.isTransitive && scaLib.path && scaLib.path.length > 2) {
                              const rootEntry = scaLib.path[scaLib.path.length - 2];
                              const atIdx = rootEntry.lastIndexOf('@');
                              importedPkgName = atIdx > 0 ? rootEntry.substring(0, atIdx) : rootEntry;
                            }
                            return (
                              <>
                                {scaLib.isTransitive && scaLib.path && scaLib.path.length > 2 && (() => {
                                  const rootEntry = scaLib.path[scaLib.path.length - 2];
                                  const atIdx = rootEntry.lastIndexOf('@');
                                  const parentName = atIdx > 0 ? rootEntry.substring(0, atIdx) : rootEntry;
                                  return (
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3 italic">
                                      {t('pages.issuePage.sca.exploitablePath.transitiveDescription', { parentName })}
                                    </p>
                                  );
                                })()}
                                <div className={cn("border rounded-xl overflow-hidden bg-zinc-50 dark:bg-white/[0.03]")}>
                                  {/* File header */}
                                  <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-white/[0.1] border-b border-zinc-200 dark:border-as-line-strong">
                                    <FileCode className="text-secondary dark:text-secondary-light text-xs flex-shrink-0"  />
                                    <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 truncate"><span className="text-zinc-500 dark:text-zinc-400">{dirPath}</span>{fileName}</span>
                                  </div>
                                  {/* Code line */}
                                  <div className="px-4 py-3 flex items-center gap-3">
                                    <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 select-none w-8 text-right flex-shrink-0">{loc.line}</span>
                                    <div className="h-4 w-px bg-zinc-300 dark:bg-zinc-500 flex-shrink-0" />
                                    <code className="font-mono text-xs text-secondary dark:text-secondary-light font-medium">
                                      {loc.content || `import ... from '${importedPkgName}';`}
                                    </code>
                                  </div>
                                </div>
                              </>
                            );
                          })()
                        ) : (
                          <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">
                            {t('pages.issuePage.sca.exploitablePath.noData')}
                          </p>
                        )}
                        {/* Navigation bar at the bottom of Exploitable Path */}
                        {scaLib.importLocations && scaLib.importLocations.length > 0 && (() => {
                          const locs = scaLib.importLocations!;
                          const idx = Math.min(importLocationIndex, locs.length - 1);
                          return (
                            <div className="flex items-center justify-between mt-auto pt-3 border-t border-zinc-200 dark:border-as-line">
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {t('pages.issuePage.sca.exploitablePath.importCount', { count: locs.length })}
                              </p>
                              {locs.length > 1 && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setImportLocationIndex(Math.max(0, idx - 1))}
                                    disabled={idx === 0}
                                    className={cn(
                                      "w-6 h-6 rounded-md flex items-center justify-center border transition-colors",
                                      idx === 0
                                        ? "border-zinc-200 dark:border-as-line-strong text-zinc-300 dark:text-zinc-500 cursor-not-allowed"
                                        : "border-zinc-300 dark:border-as-line-strong text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
                                    )}
                                  >
                                    <AngleLeft className="text-xs"  />
                                  </button>
                                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 min-w-[3rem] text-center">
                                    {idx + 1} / {locs.length}
                                  </span>
                                  <button
                                    onClick={() => setImportLocationIndex(Math.min(locs.length - 1, idx + 1))}
                                    disabled={idx === locs.length - 1}
                                    className={cn(
                                      "w-6 h-6 rounded-md flex items-center justify-center border transition-colors",
                                      idx === locs.length - 1
                                        ? "border-zinc-200 dark:border-as-line-strong text-zinc-300 dark:text-zinc-500 cursor-not-allowed"
                                        : "border-zinc-300 dark:border-as-line-strong text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
                                    )}
                                  >
                                    <AngleRight className="text-xs"  />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      )}
                    </div>
                  )}

                  {/* Two Column Layout for Details */}
                  <Slot name="finding.actions" context={{ projectId, vulnerability, vulnerabilityType: vulnerability?.vulnerabilityType }}>
                  <div className={cn("grid grid-cols-1 gap-6", !embedded && "lg:grid-cols-5")}>
                    {/* Left column - vulnerability details (3/5) */}
                    <div className="lg:col-span-3 space-y-6">
                      {/* Vulnerability details with expandable description —
                          hidden for malware: a malicious package has
                          no per-source vulnerability description to show. */}
                      {!isMalware && (
                      <div className={cn(
                        "p-4 rounded-2xl",
                        "bg-white dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]",
                        "border dark:border-as-line"
                      )}>
                        <h2 className={cn(sectionHeading)}>
                          <InfoCircle className={cn("mr-2 text-secondary dark:text-secondary-light")}  />
                          {t('pages.issuePage.vulnerabilityDetails')}
                        </h2>

                        <div className={cn(
                          "prose dark:prose-invert max-w-none mt-4",
                          embedded && "prose-sm",
                          !showFullDescription && "max-h-[300px] overflow-hidden relative"
                        )}>
                          <SafeMarkdown content={scaMeta.description || ""} linkTone="accent" />

                          {!showFullDescription && scaMeta.description && scaMeta.description.length > 500 && (
                            <div className={cn("absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-white dark:from-as-surface to-transparent")} />
                          )}
                        </div>

                        {scaMeta.description && scaMeta.description.length > 500 && (
                          <button
                            onClick={() => setShowFullDescription(!showFullDescription)}
                            className={cn("mt-2 text-secondary dark:text-secondary-light hover:underline text-sm font-medium flex items-center")}
                          >
                            {showFullDescription ? t('common.showLess') : t('common.showMore')}
                            {showFullDescription ? <AngleUp className="h-4 w-4 ml-1" /> : <AngleDown className="h-4 w-4 ml-1" />}
                          </button>
                        )}
                      </div>
                      )}

                      {/* Severities (per-source CVSS breakdown) — hidden for
                          malware: a malicious package carries no CVSS
                          source scores, so the card is meaningless. */}
                      {scaSeverities.length > 0 && !isMalware && (
                        <div className={cn(
                          "p-4 rounded-2xl",
                          "bg-white dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]",
                          "border dark:border-as-line"
                        )}>
                          <h3 className={cn("text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-3 flex items-center")}>
                            <AlertTriangle className={cn("mr-2 text-secondary dark:text-secondary-light")}  />
                            {t('pages.issuePage.severities')}
                          </h3>
                          <ul className={cn("space-y-2 text-sm")}>
                            {scaSeverities.map((sev: VulnerabilityScaSeverity) => (
                              <li key={sev.id} className={cn("flex items-center p-2 rounded-lg bg-zinc-50 dark:bg-white/[0.03]")}>
                                <AlertTriangle
                                  className={cn("mr-2 text-secondary dark:text-secondary-light min-w-[14px]")}
                                 />
                                <span className={cn("font-medium text-zinc-700 dark:text-zinc-300 mr-1 whitespace-nowrap")}>
                                  {sev.type}:
                                </span>
                                <span className={cn("text-zinc-600 dark:text-zinc-400 break-all")}>
                                  {sev.score}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Aliases and CWEs in grid */}
                      {(scaAliases.length > 0 || scaCwes.length > 0) && (
                        <div className={cn("grid grid-cols-1 gap-4", !embedded && "md:grid-cols-2")}>
                          {/* Aliases */}
                          {scaAliases.length > 0 && (
                            <div className={cn(
                              "p-4 rounded-2xl",
                              "bg-white dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]",
                              "border dark:border-as-line"
                            )}>
                              <h3 className={cn("text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-3 flex items-center")}>
                                <Tag className={cn("mr-2 text-secondary dark:text-secondary-light")}  />
                                {t('pages.issuePage.aliases')}
                              </h3>
                              <div className={cn("flex flex-wrap gap-2 break-words")}>
                                {scaAliases.map((al: VulnerabilityScaAlias) => (
                                  <span
                                    key={al.id}
                                    className={cn("inline-flex h-6 items-center px-2 text-xs rounded-md bg-zinc-200 dark:bg-white/[0.1] text-zinc-700 dark:text-zinc-200")}
                                  >
                                    {al.alias}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* CWEs */}
                          {scaCwes.length > 0 && (
                            <div className={cn(
                              "p-4 rounded-2xl",
                              "bg-white dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]",
                              "border dark:border-as-line"
                            )}>
                              <h3 className={cn("text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-3 flex items-center")}>
                                <ShieldAlt className={cn("mr-2 text-secondary dark:text-secondary-light")}  />
                                {t('pages.issuePage.cwes')}
                              </h3>
                              <div className={cn("flex flex-wrap gap-2 break-words")}>
                                {scaCwes.map((cwe: VulnerabilityScaCwe) => {
                                  const splitted = cwe.cweId.split("-");
                                  const cweNum = splitted[1] || "000";
                                  const cweUrl = `https://cwe.mitre.org/data/definitions/${cweNum}.html`;
                                  return (
                                    <a
                                      key={cwe.id}
                                      href={cweUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={cn("relative inline-flex h-6 items-center px-2 text-xs rounded-md bg-zinc-200 dark:bg-white/[0.1] text-secondary dark:text-secondary-light hover:underline", AS_TOUCH)}
                                    >
                                      {cwe.cweId}
                                    </a>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right column - References (2/5) */}
                    <div className="lg:col-span-2">
                      {scaReferences.length > 0 && (
                        <div className={cn(
                          "p-4 rounded-2xl max-h-[600px] overflow-y-auto break-words",
                          "bg-white dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]",
                          "border dark:border-as-line"
                        )}>
                          <h3 className={cn(sectionHeading)}>
                            <Link className={cn("mr-2 text-secondary dark:text-secondary-light")}  />
                            {t('pages.issuePage.references')}
                          </h3>
                          <ul className={cn("space-y-3 text-sm text-zinc-700 dark:text-zinc-300")}>
                            {scaReferences.map((ref: VulnerabilityScaReference) => (
                              <li key={ref.id} className={cn("border-b dark:border-as-line pb-3 last:border-0 last:pb-0")}>
                                <div className="flex items-start">
                                  <Link className={cn("mt-1 mr-2 text-secondary dark:text-secondary-light min-w-[14px]")}  />
                                  <div>
                                    <span className="font-medium">{ref.type}</span>
                                    <a
                                      href={ref.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={cn("block mt-1 text-secondary dark:text-secondary-light hover:underline break-all")}
                                    >
                                      {ref.url}
                                    </a>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                  </Slot>
                </motion.div>
              )}

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
            </AnimatePresence>
          </div>
        </div>
      </Card>

      {/* Update vulnerability modal */}
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

export default IssueScaTemplate;
