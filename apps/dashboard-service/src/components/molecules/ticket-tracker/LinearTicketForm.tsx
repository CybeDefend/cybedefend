import React, { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import Button from "@/components/atoms/button/Button";
import Select from "@/components/atoms/select/Select";
import SegmentedControl from "@/components/atoms/segmented-control";
import { TICKET_PROVIDER_BRAND } from "@/components/atoms/ticket-badge/TicketBadge";
import { cybedefendFindingUrl } from "./cybedefendFindingUrl";
import type { IssueTracking, TicketVulnerability } from "@/server/hooks/useIssueTracking";
import {
  createLinearIssues,
  getLinearTeamOptions,
  linearRefusalKey,
  linearRefusalOf,
  listLinearTeams,
  type LinearTeam,
  type LinearTeamOptions,
} from "@/server/services/integrations/linearIntegrationsService";

/** Linear's priority scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
type PriorityValue = "0" | "1" | "2" | "3" | "4";

const PRIORITY_OPTIONS: Array<{ value: PriorityValue; labelKey: string }> = [
  { value: "0", labelKey: "components.ticketTracker.form.priorities.none" },
  { value: "1", labelKey: "components.ticketTracker.form.priorities.urgent" },
  { value: "2", labelKey: "components.ticketTracker.form.priorities.high" },
  { value: "3", labelKey: "components.ticketTracker.form.priorities.medium" },
  { value: "4", labelKey: "components.ticketTracker.form.priorities.low" },
];

const SEVERITY_PRIORITY: Record<string, PriorityValue> = { critical: "1", high: "2", medium: "3", low: "4" };

/** The priority of the most severe occurrence; any other severity gives none. */
const priorityFromSeverity = (vulnerabilities: TicketVulnerability[]): PriorityValue =>
  vulnerabilities
    .map((v) => SEVERITY_PRIORITY[(v.severity || "").toLowerCase()])
    .filter(Boolean)
    .sort()[0] ?? "0";

const OPTIONS_ERROR = "components.ticketTracker.linear.optionsError";
const CREATE_ERROR = "components.ticketTracker.linear.createError";
const CREATE_NONE = "components.ticketTracker.linear.createNone";

/** The fixed sentence of a failure: the refusal's own, else the given one. Never the server's text. */
const failureKey = (error: unknown, fallback: string): string => {
  const code = linearRefusalOf(error);
  return code ? linearRefusalKey(code) : fallback;
};

interface LinearTicketFormProps {
  tracking: IssueTracking;
  projectId: string;
  /** The occurrences the ticket is written from (those without a Linear ticket). */
  vulnerabilities: TicketVulnerability[];
  /** Called once the ticket is created. */
  onDone: () => void;
}

/**
 * Creates one Linear ticket for a group of occurrences. Team, project and
 * labels start from the project's Linear settings, the priority from the
 * highest severity; each can be changed for this ticket only. A project
 * without Linear settings starts with no team, and nothing is created until
 * one is chosen.
 */
const LinearTicketForm: React.FC<LinearTicketFormProps> = ({ tracking, projectId, vulnerabilities, onDone }) => {
  const { t } = useTranslation();
  const { organizationId } = tracking;
  // Without project settings, nothing is chosen in advance: the user picks the team.
  const config = tracking.linear.configured ? tracking.linear.config : undefined;

  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [teamId, setTeamId] = useState(config?.teamId ?? "");
  const [options, setOptions] = useState<LinearTeamOptions | null>(null);
  const [linearProjectId, setLinearProjectId] = useState(config?.linearProjectId ?? "");
  const [labelIds, setLabelIds] = useState<string[]>(() => config?.labels?.map((label) => label.id) ?? []);
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<PriorityValue>(() => priorityFromSeverity(vulnerabilities));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const teamHintId = useId();

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    listLinearTeams(organizationId)
      .then((list) => {
        if (!cancelled) setTeams(list);
      })
      .catch((error) => {
        if (!cancelled) setErrorKey(failureKey(error, OPTIONS_ERROR));
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId || !teamId) return;
    let cancelled = false;
    setOptions(null);
    getLinearTeamOptions(organizationId, teamId)
      .then((teamOptions) => {
        if (!cancelled) setOptions(teamOptions);
      })
      .catch((error) => {
        if (!cancelled) setErrorKey(failureKey(error, OPTIONS_ERROR));
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, teamId]);

  // Projects, labels and members belong to a team: another team starts empty.
  const changeTeam = (value: string) => {
    if (value === teamId) return;
    setTeamId(value);
    setLinearProjectId("");
    setLabelIds([]);
    setAssigneeId("");
    setErrorKey(null);
  };

  const submit = async () => {
    if (!teamId) return;
    setIsSubmitting(true);
    setErrorKey(null);
    try {
      const origin = window.location.origin;
      const chosenLabelIds = labelIds.filter(Boolean);
      const result = await createLinearIssues(organizationId, projectId, {
        scanId: "",
        mode: 2,
        vulnerabilities: vulnerabilities.map((v) => ({
          ...v,
          cybedefendUrl: cybedefendFindingUrl(origin, projectId, v.scannerType, v.vulnerabilityId),
        })),
        cybedefendBaseUrl: origin,
        teamId,
        // The gateway refuses an empty id: an id not chosen is left out, never sent as "".
        ...(linearProjectId ? { linearProjectId } : {}),
        ...(chosenLabelIds.length > 0 ? { labelIds: chosenLabelIds } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        priority: Number(priority),
      });
      if (result.issues?.length > 0) {
        toast.success(t("components.ticketTracker.linear.createSuccess"));
        onDone();
      } else {
        setErrorKey(CREATE_NONE);
      }
    } catch (error) {
      setErrorKey(failureKey(error, CREATE_ERROR));
    } finally {
      setIsSubmitting(false);
    }
  };

  const teamOptions = teams.map((team) => ({ value: team.id, label: `${team.name} (${team.key})` }));
  const projectOptions = [
    { value: "", label: t("components.ticketTracker.form.noProject") },
    ...(options?.projects ?? []).map((project) => ({ value: project.id, label: project.name })),
  ];
  const labelOptions = (options?.labels ?? []).map((label) => ({ value: label.id, label: label.name }));
  const memberOptions = [
    { value: "", label: t("components.ticketTracker.unassigned") },
    ...(options?.members ?? []).map((member) => ({ value: member.id, label: member.name || member.displayName })),
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t("components.ticketTracker.form.occurrences", { count: vulnerabilities.length })}
      </p>

      <div>
        <Select
          label={t("components.ticketTracker.team")}
          placeholder={t("components.ticketTracker.form.teamPlaceholder")}
          options={teamOptions}
          value={teamId}
          onChange={changeTeam}
          required
          aria-describedby={teamId ? undefined : teamHintId}
          searchable
        />
        {!teamId && (
          <p id={teamHintId} className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t("components.ticketTracker.form.teamRequired")}
          </p>
        )}
      </div>
      <Select
        label={t("components.ticketTracker.project")}
        placeholder={t("components.ticketTracker.form.noProject")}
        options={projectOptions}
        value={linearProjectId}
        onChange={setLinearProjectId}
        disabled={!teamId}
        searchable
      />
      <Select
        multiple
        label={t("components.ticketTracker.form.labels")}
        placeholder={t("components.ticketTracker.form.noLabels")}
        options={labelOptions}
        value={labelIds}
        onChange={setLabelIds}
        disabled={!teamId}
        searchable
      />
      <Select
        label={t("components.ticketTracker.assignee")}
        placeholder={t("components.ticketTracker.unassigned")}
        options={memberOptions}
        value={assigneeId}
        onChange={setAssigneeId}
        disabled={!teamId}
        searchable
      />

      <div>
        <p className="mb-1.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
          {t("components.ticketTracker.priority")}
        </p>
        <SegmentedControl<PriorityValue>
          ariaLabel={t("components.ticketTracker.priority")}
          value={priority}
          onChange={setPriority}
          options={PRIORITY_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
        />
      </div>

      {errorKey && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t(errorKey)}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={submit}
          disabled={isSubmitting || !teamId || vulnerabilities.length === 0}
        >
          {isSubmitting ? t("common.loading") : t("components.ticketTracker.createTicket", { tool: TICKET_PROVIDER_BRAND.linear.name })}
        </Button>
      </div>
    </div>
  );
};

export default LinearTicketForm;
