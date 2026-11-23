import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { productHome } from "@/utils/product";

import Modal from "../../atoms/modal/Modal";
import Button from "../../atoms/button/Button";
import { ArrowRight, Check, Github} from '@/components/atoms/icon/icons';
import { AS_NOTICE_FRAME, AS_NOTICE_DOT_BLOCK, AS_NOTICE_TITLE, NOTICE_DOT } from '@/components/atoms/appsec/recipes';
// GitLab is a trademark, so it keeps its official mark rather than a redrawn one.
import { SiGitlab as Gitlab } from 'react-icons/si';

interface IssueIntegrationInfoModalProps {
    onClose: () => void;
    integrationType: "github" | "gitlab";
}

const IssueIntegrationInfoModal: React.FC<IssueIntegrationInfoModalProps> = ({
    onClose,
    integrationType,
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const isGithub = integrationType === "github";
    const icon = isGithub ? Github : Gitlab;
    const bgColor = isGithub ? "bg-zinc-900 dark:bg-as-raised" : "bg-orange-600 dark:bg-orange-700";

    // The issues come from AppSec findings and are switched on in an AppSec project's settings: « my projects » is the AppSec home, not the root the landing rule decides.
    const handleGoToProjects = () => {
        onClose();
        navigate(productHome("appsec"));
    };

    return (
        <Modal
            title={t(`components.issueIntegrationModal.title.${integrationType}`)}
            onClose={onClose}
            width="max-w-5xl"
            customMaxWidth="64rem"
            footerButtons={
                <>
                    <Button
                        variant="white"
                        onClick={onClose}
                    >
                        {t('common.close')}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleGoToProjects}
                    >
                        {t('components.issueIntegrationModal.goToProjects')}
                        <ArrowRight className="h-4 w-4 ml-2"  />
                    </Button>
                </>
            }
        >
            <div className="space-y-6">
                {/* Icon Header */}
                <div className="flex justify-center">
                    <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${bgColor}`}>
                        {React.createElement(icon, { className: "h-7 w-7 text-white" })}
                    </div>
                </div>

                {/* Description */}
                <div className="text-center">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        {t(`components.issueIntegrationModal.description.${integrationType}`)}
                    </p>
                </div>

                {/* Steps */}
                <div className="space-y-4">
                    <h3 className="text-[15px] font-medium tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">
                        {t('components.issueIntegrationModal.stepsTitle')}
                    </h3>

                    {/* Step 1 */}
                    <div className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 dark:border-as-line">
                        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-secondary/15 dark:bg-secondary/20">
                            <span className="text-xs font-medium tabular-nums text-secondary dark:text-secondary-light">1</span>
                        </div>
                        <div className="flex-1">
                            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {t(`components.issueIntegrationModal.step1.title.${integrationType}`)}
                            </h4>
                            <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                                {t(`components.issueIntegrationModal.step1.description.${integrationType}`)}
                            </p>
                        </div>
                        <Check
                            className="h-4 w-4 flex-shrink-0 text-green-500"
                         />
                    </div>

                    {/* Step 2 */}
                    <div className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 dark:border-as-line">
                        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-secondary/15 dark:bg-secondary/20">
                            <span className="text-xs font-medium tabular-nums text-secondary dark:text-secondary-light">2</span>
                        </div>
                        <div className="flex-1">
                            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {t('components.issueIntegrationModal.step2.title')}
                            </h4>
                            <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                                {t('components.issueIntegrationModal.step2.description')}
                            </p>
                        </div>
                    </div>

                    {/* Step 3 */}
                    <div className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 dark:border-as-line">
                        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-secondary/15 dark:bg-secondary/20">
                            <span className="text-xs font-medium tabular-nums text-secondary dark:text-secondary-light">3</span>
                        </div>
                        <div className="flex-1">
                            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {t('components.issueIntegrationModal.step3.title')}
                            </h4>
                            <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                                {t('components.issueIntegrationModal.step3.description')}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Info Box */}
                <div className={AS_NOTICE_FRAME}>
                    <div className="flex gap-2">
                        <span aria-hidden className={`${AS_NOTICE_DOT_BLOCK} ${NOTICE_DOT.info}`} />
                        <div>
                            <p className={AS_NOTICE_TITLE}>{t('components.issueIntegrationModal.infoTitle')}</p>
                            <p className="mt-1">{t('components.issueIntegrationModal.infoDescription')}</p>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default IssueIntegrationInfoModal;
