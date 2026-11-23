import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import Modal from "@/components/atoms/modal/Modal";
import Button from "@/components/atoms/button/Button";
import Input from "@/components/atoms/input/Input";
import SegmentedControl from "@/components/atoms/segmented-control";
import TicketBadge, { TICKET_PROVIDER_BRAND } from "@/components/atoms/ticket-badge/TicketBadge";
import { cybedefendFindingUrl } from "./cybedefendFindingUrl";
import {
  groupTicketsOf,
  ticketToolAvailable,
  TICKET_PROVIDERS,
  type IssueTracking,
  type TicketProvider,
  type TicketStatusCategory,
  type TicketVulnerability,
} from "@/server/hooks/useIssueTracking";
import { createJiraIssues, linkJiraIssue } from "@/server/services/integrations/jiraIntegrationsService";
import {
  linearRefusalKey,
  linearRefusalOf,
  linkLinearIssue,
} from "@/server/services/integrations/linearIntegrationsService";
import { cn } from "@/utils/function/utils";
import LinearTicketForm from "./LinearTicketForm";

type View = "main" | "link" | "create";

/** What a ticket's container is called: a Jira project, a Linear team. */
const CONTAINER_LABEL_KEY: Record<TicketProvider, string> = {
  jira: "components.ticketTracker.project",
  linear: "components.ticketTracker.team",
};

const STATUS_TONE: Record<TicketStatusCategory, string> = {
  new: "text-zinc-600 dark:text-zinc-400",
  indeterminate: "text-blue-700 dark:text-blue-300",
  done: "text-green-700 dark:text-green-400",
};

interface TicketTrackerProps {
  tracking: IssueTracking;
  projectId: string;
  groupName: string;
  occurrenceIds: string[];
  /**
   * The group's occurrences. For each tool, the tracker sends those without a
   * ticket of that tool.
   */
  vulnerabilities: TicketVulnerability[];
}

/**
 * The Jira and Linear tickets of a group of occurrences: the trigger shows the
 * first one, the dialog lists them all and creates or links a ticket in a
 * tool that can take one (Jira configured for the project, Linear connected
 * to the organisation) for the occurrences that have none there.
 */
const TicketTracker: React.FC<TicketTrackerProps> = ({
  tracking,
  projectId,
  groupName,
  occurrenceIds,
  vulnerabilities,
}) => {
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState(false);
  const [view, setView] = useState<View>("main");
  const [chosenProvider, setChosenProvider] = useState<TicketProvider | null>(null);
  const [linkRef, setLinkRef] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const group = groupTicketsOf(tracking, occurrenceIds);
  // Jira once configured for the project, Linear once connected to the organisation.
  const available = TICKET_PROVIDERS.filter((p) => ticketToolAvailable(tracking, p));
  // The tool the dialog works on: the one chosen, else the first available
  // tool with occurrences left to track.
  const provider: TicketProvider | undefined =
    chosenProvider && available.includes(chosenProvider)
      ? chosenProvider
      : available.find((p) => group.unlinkedByProvider[p].length > 0) ?? available[0];
  const toolName = provider ? TICKET_PROVIDER_BRAND[provider].name : "";

  const unlinkedIds = provider ? group.unlinkedByProvider[provider] : [];
  const unlinkedSet = new Set(unlinkedIds);
  const unlinkedVulnerabilities = vulnerabilities.filter((v) => unlinkedSet.has(v.vulnerabilityId));
  const providerTickets = group.tickets.filter((ticket) => ticket.provider === provider);
  const hasTickets = group.tickets.length > 0;
  const hasUnlinked = unlinkedIds.length > 0;
  const anyUnlinked = available.some((p) => group.unlinkedByProvider[p].length > 0);

  if (!hasTickets && available.length === 0) return null;

  const openModal = () => {
    setView("main");
    setChosenProvider(null);
    setShowModal(true);
  };
  const closeModal = () => setShowModal(false);
  const finish = () => {
    setShowModal(false);
    void tracking.refresh();
  };

  // Jira: the request the Jira-only tracker sent, unchanged.
  const createJiraTicket = async () => {
    setIsSubmitting(true);
    try {
      const origin = window.location.origin;
      const result = await createJiraIssues(tracking.organizationId, projectId, {
        scanId: "",
        mode: 2,
        vulnerabilities: unlinkedVulnerabilities.map((v) => ({
          ...v,
          cybedefendUrl: cybedefendFindingUrl(origin, projectId, v.scannerType, v.vulnerabilityId),
        })),
        cybedefendBaseUrl: origin,
        jiraProjectKey: tracking.jira.projectKey,
      });
      if (result.issues?.length > 0) {
        toast.success(t("components.jiraIntegration.createSuccess"));
        finish();
      } else {
        toast.error(t("components.jiraIntegration.createError"));
      }
    } catch {
      toast.error(t("components.jiraIntegration.createError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreate = () => {
    if (provider === "jira") void createJiraTicket();
    else setView("create");
  };

  const handleLink = async () => {
    const ref = linkRef.trim();
    if (!ref || !provider) return;
    setIsSubmitting(true);
    const origin = window.location.origin;
    const payload = {
      vulnerabilityIds: unlinkedVulnerabilities.map((v) => v.vulnerabilityId),
      scannerType: unlinkedVulnerabilities[0]?.scannerType || "sast",
      vulnerabilities: unlinkedVulnerabilities.map((v) => ({
        vulnerabilityId: v.vulnerabilityId,
        scannerType: v.scannerType,
        severity: v.severity,
        name: v.name,
        filePath: v.filePath,
        startLine: v.startLine,
      })),
      cybedefendBaseUrl: origin,
    };
    try {
      if (provider === "jira") {
        await linkJiraIssue(tracking.organizationId, projectId, { jiraIssueKey: ref, ...payload });
        toast.success(t("components.jiraIntegration.linkSuccess"));
      } else {
        await linkLinearIssue(tracking.organizationId, projectId, { issueRef: ref, ...payload });
        toast.success(t("components.ticketTracker.linear.linkSuccess"));
      }
      finish();
    } catch (error) {
      if (provider === "jira") {
        toast.error(t("components.jiraIntegration.linkError"));
      } else {
        const code = linearRefusalOf(error);
        toast.error(t(code ? linearRefusalKey(code) : "components.ticketTracker.linear.linkError"));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const footerButtons = (
    <div className="flex gap-2">
      {view !== "main" && (
        <Button variant="secondary" onClick={() => setView("main")} disabled={isSubmitting}>
          {t("common.back")}
        </Button>
      )}
      <Button variant="secondary" onClick={closeModal} disabled={isSubmitting}>
        {t("common.close")}
      </Button>
      {view === "link" && (
        <Button variant="primary" onClick={handleLink} disabled={isSubmitting || !linkRef.trim()}>
          {isSubmitting ? t("common.loading") : t("components.ticketTracker.confirmLink")}
        </Button>
      )}
    </div>
  );

  const firstTicket = group.tickets[0];

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        onClick={(e) => {
          e.stopPropagation();
          openModal();
        }}
        className={cn(
          "gap-1.5 px-2 py-1",
          hasTickets &&
            "bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40 dark:hover:text-blue-300",
        )}
      >
        {firstTicket ? (
          <>
            <img
              src={TICKET_PROVIDER_BRAND[firstTicket.provider].logo}
              alt={TICKET_PROVIDER_BRAND[firstTicket.provider].name}
              className="h-4 w-4"
            />
            <span>{firstTicket.key}</span>
            {group.tickets.length > 1 && <span className="opacity-50">+{group.tickets.length - 1}</span>}
          </>
        ) : (
          available.map((p) => (
            <img key={p} src={TICKET_PROVIDER_BRAND[p].logo} alt={TICKET_PROVIDER_BRAND[p].name} className="h-4 w-4" />
          ))
        )}
        {anyUnlinked && (
          <span aria-hidden="true" className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-orange-500" />
        )}
      </Button>

      {showModal && (
        <Modal
          title={t("components.ticketTracker.title")}
          onClose={closeModal}
          size="md"
          footerButtons={footerButtons}
        >
          <div className="p-1">
            <div className="mb-4 flex items-center gap-2 border-b border-zinc-100 pb-3 dark:border-as-line">
              <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{groupName}</span>
              <span className="ml-auto shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                {t("components.ticketTracker.occurrencesShort", { count: group.totalOccurrences })}
              </span>
            </div>

            {view === "main" && (
              <div className="space-y-3">
                {available.length > 1 && provider && (
                  <SegmentedControl<TicketProvider>
                    ariaLabel={t("components.ticketTracker.toolChoice")}
                    value={provider}
                    onChange={setChosenProvider}
                    options={available.map((p) => ({
                      value: p,
                      label: TICKET_PROVIDER_BRAND[p].name,
                      icon: <img src={TICKET_PROVIDER_BRAND[p].logo} alt="" className="h-4 w-4" />,
                    }))}
                  />
                )}

                {hasTickets && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {t("components.ticketTracker.linkedTickets")}
                    </p>
                    <div className="space-y-2">
                      {group.tickets.map((ticket) => (
                        <Button
                          key={`${ticket.provider}:${ticket.key}`}
                          variant="row"
                          href={ticket.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-col items-stretch gap-2 rounded-lg border border-zinc-200 p-3 hover:border-zinc-300 hover:bg-zinc-50 dark:border-as-line dark:hover:border-white/[0.2] dark:hover:bg-white/[0.06]"
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2">
                              <TicketBadge provider={ticket.provider} ticketKey={ticket.key} />
                              {ticket.status && (
                                <span className={cn("text-xs font-medium", STATUS_TONE[ticket.statusCategory])}>
                                  {ticket.status}
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              {t("components.ticketTracker.occurrencesShort", {
                                count: ticket.linkedVulnerabilityIds.length,
                              })}
                            </span>
                          </span>
                          <span className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                            {ticket.container && (
                              <span>
                                {t(CONTAINER_LABEL_KEY[ticket.provider])}: {ticket.container}
                              </span>
                            )}
                            {ticket.priority && (
                              <span>
                                {t("components.ticketTracker.priority")}: {ticket.priority}
                              </span>
                            )}
                            {ticket.assignee ? (
                              <span>
                                {t("components.ticketTracker.assignee")}: {ticket.assignee}
                              </span>
                            ) : (
                              <span className="italic">{t("components.ticketTracker.unassigned")}</span>
                            )}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {provider && hasUnlinked && (
                  <div className="rounded-lg border border-orange-100 bg-orange-50 p-3 dark:border-orange-900/50 dark:bg-orange-950/30">
                    <p className="text-sm text-orange-800 dark:text-orange-300">
                      {t("components.ticketTracker.unlinked", { count: unlinkedIds.length, tool: toolName })}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="primary" onClick={handleCreate} disabled={isSubmitting}>
                        {isSubmitting
                          ? t("common.loading")
                          : t("components.ticketTracker.createTicket", { tool: toolName })}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setLinkRef("");
                          setView("link");
                        }}
                        disabled={isSubmitting}
                      >
                        {t("components.ticketTracker.linkTicket")}
                      </Button>
                    </div>
                  </div>
                )}

                {provider && !hasUnlinked && hasTickets && (
                  <div className="rounded-lg border border-green-100 bg-green-50 p-3 dark:border-green-900/50 dark:bg-green-950/30">
                    <p className="text-sm text-green-700 dark:text-green-300">
                      {t("components.ticketTracker.allLinked", { tool: toolName })}
                    </p>
                  </div>
                )}

                {!hasTickets && !hasUnlinked && (
                  <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    {t("components.ticketTracker.noTickets")}
                  </p>
                )}
              </div>
            )}

            {view === "link" && provider && (
              <div className="space-y-4">
                {providerTickets.length > 0 && (
                  <>
                    <div>
                      <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {t("components.ticketTracker.addToExisting")}
                      </p>
                      <div className="space-y-1">
                        {providerTickets.map((ticket) => (
                          <Button
                            key={ticket.key}
                            variant="outline"
                            fullWidth
                            aria-pressed={linkRef === ticket.key}
                            onClick={() => setLinkRef(ticket.key)}
                            className={cn(
                              "h-auto justify-between py-2",
                              linkRef === ticket.key &&
                                "border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20",
                            )}
                          >
                            <TicketBadge provider={ticket.provider} ticketKey={ticket.key} />
                            {ticket.status && (
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">{ticket.status}</span>
                            )}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 border-t border-zinc-200 dark:border-as-line" />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("common.or")}</span>
                      <div className="flex-1 border-t border-zinc-200 dark:border-as-line" />
                    </div>
                  </>
                )}

                {provider === "jira" ? (
                  <Input
                    label={t("components.ticketTracker.jiraKeyLabel")}
                    value={linkRef}
                    onChange={(e) => setLinkRef(e.target.value.toUpperCase())}
                    placeholder="KAN-123"
                    autoFocus
                  />
                ) : (
                  <Input
                    label={t("components.ticketTracker.linearRefLabel")}
                    value={linkRef}
                    onChange={(e) => setLinkRef(e.target.value)}
                    placeholder={t("components.ticketTracker.linearRefPlaceholder")}
                    autoFocus
                  />
                )}
              </div>
            )}

            {view === "create" && (
              <LinearTicketForm
                tracking={tracking}
                projectId={projectId}
                vulnerabilities={unlinkedVulnerabilities}
                onDone={finish}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

export default TicketTracker;
