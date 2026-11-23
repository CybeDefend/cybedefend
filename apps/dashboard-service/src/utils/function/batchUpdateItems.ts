import {
  BatchUpdateItem,
  BatchUpdatePriority,
  BatchUpdateStatus,
} from "../../server/interfaces/Vulnerability";

/** Payload produced by `BatchUpdateModal.onSubmit`. */
export interface BatchUpdateFormData {
  status?: string;
  priority?: string;
  comment?: string;
  /** Mandatory server-side when `status === 'ignored'`. */
  dismissalReason?: string;
}

/**
 * Map the batch modal's payload onto the `items[]` the gateway expects.
 *
 * Shared by the six results pages (sast / iac / sca / secret / cicd /
 * container), which used to inline the same spread each. `dismissalReason` is
 * PER ITEM in `BatchUpdateVulnerabilityItemDto` — a batch legitimately mixes a
 * dismissal with a resolve — so the single reason the operator typed is
 * stamped onto every selected finding.
 *
 * A blank reason is dropped rather than forwarded: the gateway refuses it
 * (`@Matches(/\S/)`), so sending it would only produce a confusing error.
 * This is convenience, NOT a control — the control is the gateway DTO and
 * `assertDismissalReason` in analysis-reporting.
 */
export function buildBatchUpdateItems(
  vulnerabilityIds: string[],
  data: BatchUpdateFormData,
): BatchUpdateItem[] {
  const dismissalReason =
    data.status === "ignored" ? (data.dismissalReason ?? "").trim() : "";

  return vulnerabilityIds.map((vulnerabilityId) => ({
    vulnerabilityId,
    ...(data.status && { status: data.status as BatchUpdateStatus }),
    ...(data.priority && { priority: data.priority as BatchUpdatePriority }),
    ...(data.comment && { comment: data.comment }),
    ...(dismissalReason && { dismissalReason }),
  }));
}
