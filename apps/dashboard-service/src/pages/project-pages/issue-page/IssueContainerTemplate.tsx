import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import SafeMarkdown from '@/components/atoms/safe-markdown/SafeMarkdown';
import { motion, AnimatePresence } from 'framer-motion';

import { ContainerVulnerabilityResult, CVSSInfo, HistoryItem } from '@/server/interfaces/Vulnerability';
import Card from '@/components/atoms/card/Card';
import SeverityBadge from '@/components/atoms/badge/SeverityBadge';
import SeverityChip, { priorityChipLevel } from '@/components/atoms/badge/SeverityChip';
import ScoringSourceBadge from '@/components/atoms/badge/ScoringSourceBadge';
import DetectionSourceBadge from '@/components/atoms/badge/DetectionSourceBadge';
import BackButton from '@/components/atoms/button/BackButton';
import useSmartBack from '@/server/hooks/useSmartBack';
import { productHome, projectPath } from '@/utils/product';
import Button from '@/components/atoms/button/Button';
import HistoryTimeline from '@/components/molecules/issue/history-timeline/HistoryTimeline';
import ExploitabilityMetaTile from '@/components/molecules/issue/exploitability-meta-tile/ExploitabilityMetaTile';
import ScoringExploitabilityTab from '@/components/molecules/scoring/ScoringExploitabilityTab';
import UpdateVulnerabilityModal from '@/components/molecules/modal/update-vulnerability-modal/UpdateVulnerabilityModal';
import { cn, convertDate, getStatusLabel, getPriorityLabel } from '@/utils/function/utils';
import NotFoundElement from '@/components/molecules/not-found-element/NotFoundElement';
import TicketTracker from '@/components/molecules/ticket-tracker/TicketTracker';
import { trackingForBranch, type IssueTracking } from '@/server/hooks/useIssueTracking';
import { Slot } from '@/edition/slots';

import { AlertTriangle, Box, CalendarAlt, CheckCircle, Cube, Edit, FileCode, History, InfoCircle, LayerGroup, Link, MapSigns, ShieldAlt, Star, TimesCircle, Tools } from '@/components/atoms/icon/icons';
import { AS_FOCUS_INSET, AS_TAG, AS_TOUCH } from '@/components/atoms/appsec/styles';

/**
 * @interface IssueContainerTemplateProps
 * @description Props for the IssueContainerTemplate component.
 */
interface IssueContainerTemplateProps {
    vulnerability: ContainerVulnerabilityResult;
    showModal: boolean;
    onCloseModal: () => void;
    handleUpdateVulnerability: (data: any) => void;
    handleOpenModal: () => void;
    error?: string | null;
    isProjectParsed?: boolean;
    projectId?: string;
    /** The Jira and Linear tickets of the project. */
    issueTracking?: IssueTracking;
    /** Rendered inside the quick-view drawer: drop the page chrome. */
    embedded?: boolean;
}

type ContainerActiveTab = 'details' | 'scoring' | 'history';

interface HeaderCvss {
    score: number;
    label: string;
    version: 'v4' | 'v3' | 'legacy';
}

/**
 * Resolves the score shown in the header badge. Preference order mirrors the
 * SCA template: CVSS 4.0 (environmental over base) → persisted CVSS v3 score
 * (Trivy ingestion) → best score from the per-source OSV cvss map.
 */
const resolveHeaderCvss = (
    vulnerability: ContainerVulnerabilityResult,
): HeaderCvss | null => {
    const env = vulnerability.cvss4EnvironmentalScore;
    const base = vulnerability.cvss4BaseScore;
    if (env != null || base != null) {
        return { score: env ?? base ?? 0, label: 'CVSS 4.0', version: 'v4' };
    }
    if (typeof vulnerability.cvssScore === 'number' && vulnerability.cvssScore > 0) {
        return { score: vulnerability.cvssScore, label: 'CVSS v3.1', version: 'v3' };
    }
    const cvssMap: { [key: string]: CVSSInfo } = vulnerability.vulnerability?.cvss ?? {};
    for (const source of Object.keys(cvssMap)) {
        const v3 = cvssMap[source]?.v3Score;
        if (typeof v3 === 'number' && v3 > 0) {
            return { score: v3, label: `CVSS v3.1 (${source})`, version: 'v3' };
        }
    }
    for (const source of Object.keys(cvssMap)) {
        const v2 = cvssMap[source]?.v2Score;
        if (typeof v2 === 'number' && v2 > 0) {
            return { score: v2, label: `CVSS v2.0 (${source})`, version: 'legacy' };
        }
    }
    return null;
};

/**
 * Safely extracts history items, whether they are in a direct array or a wrapped object.
 */
const getHistoryItems = (historyData: HistoryItem[] | { items: HistoryItem[] } | undefined): HistoryItem[] => {
    if (!historyData) return [];
    if (Array.isArray(historyData)) {
        return historyData;
    }
    return historyData.items || [];
}

const getCvssBorderColor = (score: number) => {
    if (score >= 9.0) return cn("border-critical-risk");
    if (score >= 7.0) return cn("border-high-risk");
    if (score >= 4.0) return cn("border-medium-risk");
    return cn("border-low-risk");
};
const getCvssTextColor = (score: number) => {
    if (score >= 9.0) return cn("text-critical-risk");
    if (score >= 7.0) return cn("text-high-risk");
    if (score >= 4.0) return cn("text-medium-risk");
    return cn("text-low-risk");
};

const DESCRIPTION_COLLAPSE_THRESHOLD = 500;

/**
 * Renders the detailed view for a single container vulnerability, aligned on
 * the SCA template: tabbed layout (details / scoring / history), CVSS 4.0
 * aware header badge with scoring-source provenance, and exploitability tile.
 */
const IssueContainerTemplate: React.FC<IssueContainerTemplateProps> = ({
    vulnerability,
    showModal,
    onCloseModal,
    handleUpdateVulnerability,
    handleOpenModal,
    error,
    isProjectParsed,
    projectId,
    issueTracking,
    embedded = false,
}) => {
    // The branch the finding was detected on, which decides the ticket tools offered.
    const findingBranch = (vulnerability as { branch?: string } | null)?.branch;
    const { t } = useTranslation();

    // History-aware back: returns to the list the user came from, or falls
    // back to the AppSec container list page on a deep link (where -1 would
    // leave the app); without a project, the AppSec home rather than the root.
    const smartBack = useSmartBack(projectId ? projectPath('appsec', projectId, 'container') : productHome('appsec'));
    const [activeTab, setActiveTab] = useState<ContainerActiveTab>('details');
    const [showFullDescription, setShowFullDescription] = useState(false);

    // Compact, label-style section headings + tighter prose inside the drawer;
    // the full-page layout keeps its larger headings.
    const sectionHeading = embedded
        ? "text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2 flex items-center gap-2"
        : "text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2";

    if (error) return <NotFoundElement title={t('pages.issuePage.noVulnerabilityTitle')} description={error} onShowAll={smartBack} />
    if (!vulnerability?.vulnerability || !vulnerability?.package) {
        return <NotFoundElement title={t('pages.issuePage.invalidContainerDataTitle')} description={t('pages.issuePage.invalidContainerDataDescription')} onShowAll={smartBack} />
    }

    const severity = vulnerability.currentSeverity.toLowerCase() as any;
    const headerCvss = resolveHeaderCvss(vulnerability);
    const historyItems = getHistoryItems(vulnerability.historyItems);
    const isFixAvailable = !!(vulnerability.vulnerability.fixedVersion || vulnerability.fixedVersion);
    const fixedVersion = vulnerability.vulnerability.fixedVersion || vulnerability.fixedVersion || '';
    const description = vulnerability.vulnerability.description || '';
    const isLongDescription = description.length > DESCRIPTION_COLLAPSE_THRESHOLD;
    const visibleDescription =
        isLongDescription && !showFullDescription
            ? `${description.slice(0, DESCRIPTION_COLLAPSE_THRESHOLD)}…`
            : description;

    const TabButton: React.FC<{ tabName: ContainerActiveTab; label: string; icon: any }> = ({ tabName, label, icon }) => (
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
            className={cn("flex flex-col", embedded ? "" : "mx-auto px-4 py-6 min-h-[calc(100vh-6rem)] bg-zinc-50 dark:bg-as-bg")}
        >
            {!embedded && (
                <div className="mb-4">
                    <BackButton text={t('components.analyseWrapper.backToVulnerabilities')} onClick={smartBack} />
                </div>
            )}
            <Card
                severity={embedded ? undefined : severity}
                padding={embedded ? "sm" : undefined}
                className={cn(
                    "flex-grow rounded-2xl",
                    embedded && "!rounded-none !border-0 !bg-transparent !shadow-none",
                )}
            >
                {/* HEADER: CVE Title + CVSS badge + Actions */}
                <div className={cn("flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6")}>
                    <div className={cn("flex items-start gap-4")}>
                        <SeverityBadge severity={severity} />
                        <div>
                            <h1 className={cn("font-semibold tracking-[-0.02em] text-zinc-900 dark:text-zinc-50", embedded ? "text-lg leading-snug" : "text-xl sm:text-2xl")}>
                                {vulnerability.vulnerabilityIdentifier || vulnerability.vulnerability.vulnerabilityId}
                            </h1>
                            {vulnerability.vulnerability.title && (
                                <p className={cn("text-sm text-zinc-600 dark:text-zinc-400 mt-1 max-w-2xl")}>
                                    {vulnerability.vulnerability.title}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex gap-3 items-center flex-wrap">
                        {headerCvss && (
                            <div className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-xl",
                                "bg-zinc-100 dark:bg-as-raised",
                                "border dark:border-as-line"
                            )}>
                                <div className={cn(
                                    "w-10 h-10 rounded-full flex items-center justify-center border-2 font-medium text-sm",
                                    "bg-white dark:bg-as-raised",
                                    getCvssBorderColor(headerCvss.score),
                                    getCvssTextColor(headerCvss.score)
                                )}>
                                    {headerCvss.score}
                                </div>
                                <div className="text-xs">
                                    <div className={cn("font-medium text-zinc-700 dark:text-zinc-300")}>{headerCvss.label}</div>
                                    <ScoringSourceBadge
                                        scoringSource={vulnerability.scoringSource as 'static' | 'agent' | null}
                                        cvssVersion={headerCvss.version}
                                        size="sm"
                                    />
                                    <DetectionSourceBadge
                                        detectionSource={vulnerability.detectionSource}
                                        size="sm"
                                        className="ml-1"
                                    />
                                </div>
                            </div>
                        )}
                        {issueTracking && projectId && (
                            // Only the tools whose project settings allow the finding's branch.
                            <TicketTracker
                                tracking={trackingForBranch(issueTracking, findingBranch)}
                                projectId={projectId}
                                groupName={vulnerability.vulnerabilityIdentifier || vulnerability.vulnerability?.vulnerabilityId || "Container Vulnerability"}
                                occurrenceIds={[vulnerability.id]}
                                vulnerabilities={[{
                                    vulnerabilityId: vulnerability.id,
                                    scannerType: "container",
                                    severity: vulnerability.currentSeverity || "medium",
                                    name: vulnerability.vulnerabilityIdentifier || vulnerability.vulnerability?.vulnerabilityId || "Container Vulnerability",
                                    shortDescription: vulnerability.vulnerability?.title || vulnerability.vulnerability?.description?.substring(0, 200),
                                    packageName: vulnerability.package?.name,
                                    packageVersion: vulnerability.package?.version,
                                    externalId: vulnerability.vulnerabilityIdentifier,
                                    branch: findingBranch,
                                }]}
                            />
                        )}
                        <Button variant="secondary" icon={<Edit className="h-4 w-4"  />} onClick={handleOpenModal}>
                            {t('pages.issuePage.updateIssue')}
                        </Button>
                    </div>
                </div>

                {/* Metadata Grid — same compact <dl> style as the SCA template */}
                <dl className={cn(
                    "grid mb-8 bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-as-line",
                    embedded
                        ? "grid-cols-2 gap-3 p-3 rounded-xl"
                        : "grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 p-4 rounded-2xl"
                )}>
                    <div className="flex items-center min-w-0">
                        <CalendarAlt className="h-4 w-4 text-zinc-400 dark:text-zinc-500 mr-3 shrink-0"  />
                        <div className="min-w-0">
                            <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.introducedOn')}</dt>
                            <dd className={cn("text-sm font-medium text-zinc-900 dark:text-zinc-100")}>{convertDate(vulnerability.createdAt)}</dd>
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
                            <dd className={cn("text-sm font-medium text-zinc-900 dark:text-zinc-100")}>{getStatusLabel(vulnerability.currentState)}</dd>
                        </div>
                    </div>
                    <div className="flex items-center min-w-0">
                        {isFixAvailable ? <CheckCircle
                            className={cn("mr-3 shrink-0", isFixAvailable ? "text-green-500" : "text-red-500")} /> : <TimesCircle
                            className={cn("mr-3 shrink-0", isFixAvailable ? "text-green-500" : "text-red-500")} />}
                        <div className="min-w-0">
                            <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.fixAvailable')}</dt>
                            <dd className={cn(
                                "text-sm font-semibold",
                                isFixAvailable ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"
                            )}>
                                {isFixAvailable ? t('common.yes') : t('common.no')}
                                {isFixAvailable && (
                                    <span className={cn("ml-1 font-mono text-xs text-zinc-500 dark:text-zinc-400")}>→ {fixedVersion}</span>
                                )}
                            </dd>
                        </div>
                    </div>
                    <div className="flex items-center min-w-0">
                        <Box className="h-4 w-4 text-zinc-400 dark:text-zinc-500 mr-3 shrink-0"  />
                        <div className="min-w-0">
                            <dt className={cn("text-xs text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.packageType')}</dt>
                            <dd className={cn("text-sm font-medium text-zinc-900 dark:text-zinc-100")}>{vulnerability.vulnerability.class}</dd>
                        </div>
                    </div>
                    <ExploitabilityMetaTile verdict={vulnerability.exploitabilityVerdict} colored={embedded} />
                </dl>

                {/* What an edition adds to the finding's overview (`finding.panels`,
                    host `issue-overview`): the Community Edition's line on Cybe
                    Analysis. No cloud registration draws at this host. */}
                <Slot
                    name="finding.panels"
                    context={{ projectId, vulnerability, vulnerabilityType: vulnerability?.vulnerabilityType, embedded, host: 'issue-overview' }}
                />

                {/* TABS — same structure as the SCA template */}
                <div className={cn("flex border-b border-zinc-200 dark:border-as-line mb-8 overflow-x-auto overflow-y-hidden scrollbar-hide")}>
                    <TabButton tabName="details" label={t('pages.issuePage.tabs.detailsAndFix')} icon={Tools} />
                    {projectId && (
                        <TabButton tabName="scoring" label={t('pages.issuePage.scoring.tabTitle')} icon={Star} />
                    )}
                    <TabButton tabName="history" label={t('pages.issuePage.tabs.history')} icon={History} />
                </div>

                {activeTab === 'details' && (
                    <>
                        {/* Package & Fix Details */}
                        <div className={cn("mb-8")}>
                            <h2 className={cn(sectionHeading)}>
                                <Tools className={cn("text-secondary dark:text-secondary-light")}  />
                                {t('pages.issuePage.fixInformation')}
                            </h2>

                            <div className={cn("grid grid-cols-1 gap-4", !embedded && "lg:grid-cols-2 xl:grid-cols-4")}>
                                {/* Affected Package */}
                                <div className={cn("p-4 sm:p-5 rounded-2xl bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]")}>
                                    <div className={cn("flex items-center gap-2 mb-2")}>
                                        <Cube className={cn("text-secondary dark:text-secondary-light text-sm")}  />
                                        <span className={cn("text-xs font-medium text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.affectedPackage')}</span>
                                    </div>
                                    <p className={cn("text-lg font-medium text-zinc-900 dark:text-zinc-50 font-mono")}>{vulnerability.package.name}</p>
                                    <p className={cn("text-sm text-zinc-500 dark:text-zinc-400 mt-1")}>
                                        v<span className={cn("font-mono font-semibold text-red-600 dark:text-red-400")}>{vulnerability.package.version}</span>
                                        {vulnerability.package.arch && (
                                            <span className={cn("ml-2 text-xs font-mono text-zinc-500 dark:text-zinc-400")}>({vulnerability.package.arch})</span>
                                        )}
                                    </p>
                                    {vulnerability.package.srcName && vulnerability.package.srcName !== vulnerability.package.name && (
                                        <p className={cn("text-xs text-zinc-500 dark:text-zinc-400 mt-1")}>
                                            {t('pages.issuePage.container.sourcePackage')}: <span className="font-mono">{vulnerability.package.srcName}</span>
                                        </p>
                                    )}
                                </div>

                                {/* Fix Version */}
                                <div className={cn("p-4 sm:p-5 rounded-2xl bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]")}>
                                    <div className={cn("flex items-center gap-2 mb-2")}>
                                        <CheckCircle className={cn("text-secondary dark:text-secondary-light text-sm")}  />
                                        <span className={cn("text-xs font-medium text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.recommendedFix')}</span>
                                    </div>
                                    {isFixAvailable ? (
                                        <p className={cn("text-lg font-medium text-green-700 dark:text-green-400 font-mono")}>{fixedVersion}</p>
                                    ) : (
                                        <p className={cn("text-lg font-medium text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.noFixAvailable')}</p>
                                    )}
                                </div>

                                {/* Package Type */}
                                <div className={cn("p-4 sm:p-5 rounded-2xl bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]")}>
                                    <div className={cn("flex items-center gap-2 mb-2")}>
                                        <MapSigns className={cn("text-secondary dark:text-secondary-light text-sm")}  />
                                        <span className={cn("text-xs font-medium text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.packageType')}</span>
                                    </div>
                                    <p className={cn("text-lg font-medium text-zinc-900 dark:text-zinc-50")}>{vulnerability.vulnerability.class}</p>
                                    <p className={cn("text-xs text-zinc-500 dark:text-zinc-400 mt-1")}>{t([`pages.issuePage.packageTypeDescription.${vulnerability.vulnerability.class}`, 'pages.issuePage.packageTypeDescription.default'])}</p>
                                </div>

                                {/* Target image (image ref + OS, straight from the scanner) */}
                                {vulnerability.vulnerability.target && (
                                    <div className={cn("p-4 sm:p-5 rounded-2xl bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]")}>
                                        <div className={cn("flex items-center gap-2 mb-2")}>
                                            <LayerGroup className={cn("text-secondary dark:text-secondary-light text-sm")}  />
                                            <span className={cn("text-xs font-medium text-zinc-500 dark:text-zinc-400")}>{t('pages.issuePage.container.targetImage')}</span>
                                        </div>
                                        <p className={cn("text-sm font-semibold text-zinc-900 dark:text-zinc-50 font-mono break-all")}>{vulnerability.vulnerability.target}</p>
                                        <p className={cn("text-xs text-zinc-500 dark:text-zinc-400 mt-1")}>{t('pages.issuePage.container.targetImageDescription')}</p>
                                    </div>
                                )}
                            </div>

                        </div>

                        {/* Description */}
                        {description && (
                            <div className={cn("mb-8")}>
                                <h2 className={cn(sectionHeading)}>
                                    <FileCode className={cn("text-secondary dark:text-secondary-light")}  />
                                    {t('common.description')}
                                </h2>
                                <Slot name="finding.actions" context={{ projectId, vulnerability, vulnerabilityType: vulnerability?.vulnerabilityType }}>
                                    <div className={cn("p-4 sm:p-6 rounded-2xl bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]")}>
                                        <div className={cn("prose dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300 leading-relaxed", embedded && "prose-sm")}>
                                            <SafeMarkdown content={visibleDescription} linkTone="accent" />
                                        </div>
                                        {isLongDescription && (
                                            <button
                                                onClick={() => setShowFullDescription(!showFullDescription)}
                                                className={cn("mt-3 text-sm font-semibold text-secondary dark:text-secondary-light hover:underline")}
                                            >
                                                {showFullDescription ? t('common.showLess') : t('common.showMore')}
                                            </button>
                                        )}
                                    </div>
                                </Slot>
                            </div>
                        )}

                        {/* Technical Details - CWEs and References */}
                        {((vulnerability.vulnerability.cweIds && vulnerability.vulnerability.cweIds.length > 0) ||
                            (vulnerability.vulnerability.references && vulnerability.vulnerability.references.length > 0)) && (
                                <div className={cn("grid grid-cols-1 gap-6 mb-8", !embedded && "lg:grid-cols-2")}>
                                    {/* CWEs */}
                                    {vulnerability.vulnerability.cweIds && vulnerability.vulnerability.cweIds.length > 0 && (
                                        <div className={cn("p-4 sm:p-5 rounded-2xl bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]")}>
                                            <h3 className={cn("text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-3 flex items-center gap-2")}>
                                                <ShieldAlt className={cn("text-blue-600 dark:text-blue-400")}  />
                                                {t('pages.issuePage.cwes')}
                                            </h3>
                                            <p className={cn("text-xs text-zinc-500 dark:text-zinc-400 mb-3")}>{t('pages.issuePage.cwesDescription')}</p>
                                            <div className={cn("flex flex-wrap gap-2")}>
                                                {vulnerability.vulnerability.cweIds.map((cweId) => {
                                                    const cweNum = cweId.split('-')[1];
                                                    return (
                                                        <a
                                                            key={cweId}
                                                            href={`https://cwe.mitre.org/data/definitions/${cweNum}.html`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            // A CWE link as the quiet tag of the SAST and SCA drawers: a hairline, violet words, a 44 px reach on a phone.
                                                            className={cn(
                                                                'relative transition-colors',
                                                                AS_TAG,
                                                                'text-secondary hover:bg-zinc-100 dark:text-secondary-light dark:hover:bg-white/[0.06]',
                                                                AS_TOUCH
                                                            )}
                                                        >
                                                            {cweId}
                                                        </a>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* References */}
                                    {vulnerability.vulnerability.references && vulnerability.vulnerability.references.length > 0 && (
                                        <div className={cn(
                                            "p-4 sm:p-5 rounded-2xl bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]",
                                            !(vulnerability.vulnerability.cweIds && vulnerability.vulnerability.cweIds.length > 0) && "lg:col-span-2"
                                        )}>
                                            <h3 className={cn("text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100 mb-3 flex items-center gap-2")}>
                                                <Link className={cn("text-indigo-600 dark:text-indigo-400")}  />
                                                {t('pages.issuePage.references')}
                                                <span className={cn("text-sm font-normal text-zinc-500 dark:text-zinc-400")}>({vulnerability.vulnerability.references.length})</span>
                                            </h3>
                                            <p className={cn("text-xs text-zinc-500 dark:text-zinc-400 mb-3")}>{t('pages.issuePage.referencesDescription')}</p>
                                            <ul className={cn("space-y-1 max-h-40 overflow-y-auto custom-scrollbar")}>
                                                {vulnerability.vulnerability.references.map((ref, index) => (
                                                    <li key={index}>
                                                        <a
                                                            href={ref}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={cn(
                                                                "flex items-center gap-2 p-2 rounded-lg text-sm text-zinc-600 dark:text-zinc-400",
                                                                "hover:bg-zinc-50 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
                                                            )}
                                                        >
                                                            <Link className={cn("text-xs text-zinc-400")}  />
                                                            <span className="truncate">{ref.replace(/^https?:\/\/(www\.)?/, '')}</span>
                                                        </a>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}
                    </>
                )}

                {/* Scoring & Exploitability */}
                {activeTab === 'scoring' && projectId && (
                    <ScoringExploitabilityTab vulnerability={vulnerability} projectId={projectId} embedded={embedded} />
                )}

                {/* Change History */}
                {activeTab === 'history' && (
                    historyItems.length > 0 ? (
                        <div className={cn("p-4 sm:p-6 rounded-2xl bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]")}>
                            <Slot name="finding.actions" context={{ projectId, vulnerability, vulnerabilityType: vulnerability?.vulnerabilityType }}>
                                <HistoryTimeline historyItems={historyItems} />
                            </Slot>
                        </div>
                    ) : (
                        <div className={cn("p-10 rounded-2xl bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line text-center dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]")}>
                            <History className={cn("text-3xl text-zinc-300 dark:text-zinc-500 mb-3")}  />
                            <h3 className={cn("text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100")}>{t('pages.issuePage.tabs.noHistoryTitle')}</h3>
                            <p className={cn("text-sm text-zinc-500 dark:text-zinc-400 mt-1")}>{t('pages.issuePage.tabs.noHistoryDescription')}</p>
                        </div>
                    )
                )}
            </Card>

            {/* Update Modal */}
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

export default IssueContainerTemplate;
