import React, { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../../atoms/button/Button";
import Modal from "../../../atoms/modal/Modal";
import Select from "../../../atoms/select/Select";
import Input from "../../../atoms/input/Input";
import StatusChangeNotice from "../status-change-notice/StatusChangeNotice";
import { priorityOptions, settableStatusOptions } from "../../../../utils/data/historyVulnData";
import { apiErrorKey } from '@/utils/function/apiErrorKey';

interface BatchUpdateModalProps {
    /** Number of selected vulnerabilities */
    selectedCount: number;
    /** Callback when modal is closed */
    onClose: () => void;
    /** Fire-and-forget: dispatches the batch update and returns void.
     *  Progress is tracked by the BackgroundTasksPanel widget. */
    onSubmit: (data: {
        status?: string;
        priority?: string;
        comment?: string;
        dismissalReason?: string;
    }) => void;
    /** Whether the update is in progress */
    isLoading?: boolean;
}

/**
 * BatchUpdateModal - Modal for bulk updating multiple vulnerabilities
 * Allows setting status, priority, and comment for all selected vulnerabilities
 */
const BatchUpdateModal: React.FC<BatchUpdateModalProps> = ({
    selectedCount,
    onClose,
    onSubmit,
    isLoading = false,
}) => {
    const { t } = useTranslation();
    const [status, setStatus] = useState<string>("");
    const [priority, setPriority] = useState<string>("");
    const [comment, setComment] = useState<string>("");
    const [dismissalReason, setDismissalReason] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const selectDropdownRef1 = useRef<HTMLDivElement>(null);
    const selectDropdownRef2 = useRef<HTMLDivElement>(null);

    const hasChanges = status || priority || comment;

    // A bulk dismissal needs the same auditable
    // justification as a single one: `BatchUpdateVulnerabilityItemDto` carries
    // it PER ITEM and `assertDismissalReason` runs on every item of the async
    // job. One reason is entered once here and stamped on every selected
    // finding, which is what the operator means by a bulk dismissal.
    //
    // UX only — the control is the gateway DTO + `assertDismissalReason`.
    const willDismiss = status === "ignored";
    const trimmedDismissalReason = dismissalReason.trim();
    // A blank reason is refused server-side too, not just an absent one.
    const dismissalReasonMissing = willDismiss && trimmedDismissalReason === "";

    // A `resolved` finding is reopened (back to `to_verify`) by the next scan
    // that detects it again, while a manual `ignored` is kept across re-scans
    // (analysis-reporting lifecycle) — same notes as the single modal: a
    // warning on `resolved`, an informational note on `ignored`.
    const willResolve = status === "resolved";

    const handleSubmit = () => {
        if (!hasChanges) return;
        if (dismissalReasonMissing) return;

        setIsSubmitting(true);
        setError(null);

        try {
            onSubmit({
                ...(status && { status }),
                ...(priority && { priority }),
                ...(comment && { comment }),
                ...(willDismiss && { dismissalReason: trimmedDismissalReason }),
            });
            // Fire-and-forget: close immediately; the BackgroundTasksPanel tracks progress.
            handleClose();
        } catch (err: any) {
            setError(t(apiErrorKey(err, { fallback: 'components.modal.batchUpdate.errorGeneric' })));
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        setStatus("");
        setPriority("");
        setComment("");
        setDismissalReason("");
        setError(null);
        onClose();
    };

    return (
        <Modal
            onClose={handleClose}
            title={t('components.modal.batchUpdate.title')}
            width="max-w-xl"
            additionalRefs={[selectDropdownRef1, selectDropdownRef2]}
            footerButtons={
                <div className="flex justify-end space-x-2">
                    <Button variant="white" onClick={handleClose} disabled={isSubmitting}>
                        {t('common.cancel')}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleSubmit}
                        disabled={!hasChanges || dismissalReasonMissing || isSubmitting}
                        loading={isSubmitting}
                    >
                        {t('components.modal.batchUpdate.updateButton', { count: selectedCount })}
                    </Button>
                </div>
            }
        >
            <div className="space-y-4">
                {/* Selected count badge */}
                <div className="flex items-center gap-2 rounded-lg border border-secondary/20 bg-secondary/5 px-3 py-2.5 dark:border-secondary-light/20 dark:bg-secondary/10">
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-secondary px-1 font-mono text-xs font-medium tabular-nums text-white">
                        {selectedCount}
                    </span>
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {t('components.modal.batchUpdate.selectedVulnerabilities', { count: selectedCount })}
                    </span>
                </div>

                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    {t('components.modal.batchUpdate.description')}
                </p>

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-800 dark:border-red-400/20 dark:bg-red-900/20 dark:text-red-300">
                        {error}
                    </div>
                )}

                <div>
                    <Select
                        label={t('common.status')}
                        value={status}
                        options={settableStatusOptions}
                        placeholder={t('components.modal.batchUpdate.selectStatus')}
                        onChange={(value) => setStatus(value)}
                        width="w-full"
                        dropdownRef={selectDropdownRef1}
                    />
                    {willResolve && (
                        <StatusChangeNotice variant="warning">
                            {t('components.modal.batchUpdate.resolvedWarning', {
                                count: selectedCount,
                                // The translated status label — never the dropdown's
                                // option label, which is untranslated English.
                                ignoredStatus: t('components.analyseWrapper.status.labels.ignored'),
                            })}
                        </StatusChangeNotice>
                    )}
                    {willDismiss && (
                        <StatusChangeNotice variant="info">
                            {t('components.modal.batchUpdate.ignoredInfo', { count: selectedCount })}
                        </StatusChangeNotice>
                    )}
                </div>

                <div>
                    <Select
                        label={t('common.priority')}
                        value={priority}
                        options={priorityOptions}
                        placeholder={t('components.modal.batchUpdate.selectPriority')}
                        onChange={(value) => setPriority(value)}
                        width="w-full"
                        dropdownRef={selectDropdownRef2}
                    />
                </div>

                {willDismiss && (
                    <div>
                        <Input
                            label={t('components.modal.batchUpdate.dismissalReasonLabel')}
                            value={dismissalReason}
                            onChange={(e) => setDismissalReason(e.target.value)}
                            placeholder={t('components.modal.batchUpdate.dismissalReasonPlaceholder')}
                            maxLength={512}
                            required
                            textarea
                        />
                        <p className="mt-1 pl-1 text-xs text-zinc-500 dark:text-zinc-400">
                            {t('components.modal.batchUpdate.dismissalReasonRequired', { count: selectedCount })}
                        </p>
                    </div>
                )}

                <Input
                    label={t('common.comment')}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={t('components.modal.batchUpdate.commentPlaceholder')}
                    maxLength={512}
                    textarea
                />

                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t('components.modal.batchUpdate.hint')}
                </p>
            </div>
        </Modal>
    );
};

export default BatchUpdateModal;
