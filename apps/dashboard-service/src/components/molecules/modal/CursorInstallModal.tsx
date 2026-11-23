import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import Modal from "../../atoms/modal/Modal";
import Button from "../../atoms/button/Button";
import { Check, Copy, Download, Terminal } from '@/components/atoms/icon/icons';
import { AS_NOTICE_FRAME, AS_NOTICE_TITLE } from '@/components/atoms/appsec/recipes';
import { AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
import { EDITION } from '@/edition/edition';
import { copyText } from '@/utils/copyText';

// A Community instance has no region, no OAuth sign-in (personal access
// tokens) and no scanner: its findings come by import.
const IMPORTS_RESULTS = EDITION === 'community';

interface CursorInstallModalProps {
    onClose: () => void;
}

const OPEN_VSX_URL = "https://open-vsx.org/extension/cybedefend/cybedefend";

const CursorInstallModal: React.FC<CursorInstallModalProps> = ({ onClose }) => {
    const { t } = useTranslation();
    const [copiedCommand, setCopiedCommand] = useState(false);

    const terminalCommand = "cursor --install-extension cybedefend-cybedefend-<version>.vsix";

    const handleCopyCommand = async () => {
        if (!(await copyText(terminalCommand))) return;
        setCopiedCommand(true);
        setTimeout(() => setCopiedCommand(false), 2000);
    };

    const handleDownload = () => {
        window.open(OPEN_VSX_URL, "_blank", "noopener,noreferrer");
    };

    return (
        <Modal
            title={t("components.cursorInstallModal.title")}
            onClose={onClose}
            width="max-w-2xl"
            customMaxWidth="42rem"
            footerButtons={
                <>
                    <Button variant="white" onClick={onClose}>
                        {t("common.close")}
                    </Button>
                    <Button variant="secondary" onClick={handleDownload}>
                        <Download className="h-4 w-4 mr-2"  />
                        {t("components.cursorInstallModal.downloadButton")}
                    </Button>
                </>
            }
        >
            <div className="space-y-6">
                {/* Icon Header */}
                <div className="flex justify-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white dark:bg-white/90 border border-zinc-200 dark:border-as-line-strong">
                        <img
                            src="/image/integrations/cursor.png"
                            alt="Cursor"
                            className="w-8 h-8 object-contain"
                        />
                    </div>
                </div>

                {/* Description */}
                <div className="text-center">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        {t("components.cursorInstallModal.description")}
                    </p>
                </div>

                {/* Steps */}
                <div className="space-y-4">
                    <h3 className="text-[15px] font-medium tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
                        {t("components.cursorInstallModal.stepsTitle")}
                    </h3>

                    {/* Step 1 */}
                    <div className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 dark:border-as-line">
                        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-secondary/15 dark:bg-secondary/20">
                            <span className="text-xs font-medium tabular-nums text-secondary dark:text-secondary-light">1</span>
                        </div>
                        <div className="flex-1">
                            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {t("components.cursorInstallModal.step1.title")}
                            </h4>
                            <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                                {t("components.cursorInstallModal.step1.description")}
                            </p>
                            <Button
                                variant="white"
                                onClick={handleDownload}
                                className="mt-3"
                            >
                                <Download className="h-4 w-4 mr-2"  />
                                {t("components.cursorInstallModal.step1.button")}
                            </Button>
                        </div>
                    </div>

                    {/* Step 2 - Option A */}
                    <div className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 dark:border-as-line">
                        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-secondary/15 dark:bg-secondary/20">
                            <span className="text-xs font-medium tabular-nums text-secondary dark:text-secondary-light">2</span>
                        </div>
                        <div className="flex-1">
                            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {t("components.cursorInstallModal.step2.title")}
                            </h4>
                            <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                                {t("components.cursorInstallModal.step2.description")}
                            </p>

                            {/* Option A */}
                            <div className="mt-3 space-y-3">
                                <div className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-as-line dark:bg-white/[0.03] p-3">
                                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                                        {t("components.cursorInstallModal.step2.optionA.label")}
                                    </p>
                                    <p className="text-[13px] text-zinc-700 dark:text-zinc-300">
                                        {t("components.cursorInstallModal.step2.optionA.description")}
                                    </p>
                                </div>

                                {/* Option B */}
                                <div className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-as-line dark:bg-white/[0.03] p-3">
                                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                                        {t("components.cursorInstallModal.step2.optionB.label")}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <code className="flex-1 text-[13px] bg-zinc-900 dark:bg-as-bg text-green-400 px-3 py-2 rounded-md border border-zinc-200 dark:border-as-line font-mono overflow-x-auto">
                                            <Terminal className="h-4 w-4 mr-2 text-zinc-500"  />
                                            {terminalCommand}
                                        </code>
                                        <button
                                            onClick={handleCopyCommand}
                                            className="relative flex-shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-zinc-200 dark:hover:bg-white/[0.06] transition-colors duration-[120ms] focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary max-md:after:absolute max-md:after:left-1/2 max-md:after:top-1/2 max-md:after:h-11 max-md:after:w-11 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-['']"
                                            title={t('common.copy')}
                                        >
                                            {copiedCommand ? <Check
                                                className={copiedCommand ? "text-green-500" : "text-zinc-500 dark:text-zinc-400"} /> : <Copy
                                                className={copiedCommand ? "text-green-500" : "text-zinc-500 dark:text-zinc-400"} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Step 3 */}
                    <div className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 dark:border-as-line">
                        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-secondary/15 dark:bg-secondary/20">
                            <span className="text-xs font-medium tabular-nums text-secondary dark:text-secondary-light">3</span>
                        </div>
                        <div className="flex-1">
                            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {t(IMPORTS_RESULTS ? "components.cursorInstallModal.step3.importTitle" : "components.cursorInstallModal.step3.title")}
                            </h4>
                            <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                                {t(IMPORTS_RESULTS ? "components.cursorInstallModal.step3.importDescription" : "components.cursorInstallModal.step3.description")}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Warning */}
                <div className={AS_NOTICE_FRAME}>
                    <div className="flex gap-2">
                        {/* The warning's title in amber: it carries the status (no dot). */}
                        <div>
                            <p className={cn(AS_NOTICE_TITLE, AS_WORD_TONE.warning)}>{t("components.cursorInstallModal.warningTitle")}</p>
                            <p className="mt-1">{t("components.cursorInstallModal.warningDescription")}</p>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default CursorInstallModal;
