import React from "react";
import { useTranslation } from "react-i18next";

import Modal from "../../atoms/modal/Modal";
import Button from "../../atoms/button/Button";

interface CommunityMcpModalProps {
    onClose: () => void;
}

/** The command that starts the Community stack, its MCP server included. */
const STACK_START_COMMAND = "docker compose up -d";

/**
 * The Community Edition's « Cybe MCP » card: the instance's own MCP server, as
 * the deployment's README describes it (started with the stack, `<public URL>/mcp`,
 * a personal access token as bearer). It links to nothing outside the
 * instance: the cloud's docs describe the cloud's server.
 */
const CommunityMcpModal: React.FC<CommunityMcpModalProps> = ({ onClose }) => {
    const { t } = useTranslation();
    return (
        <Modal
            title={t("components.communityMcpModal.title")}
            onClose={onClose}
            width="max-w-2xl"
            customMaxWidth="42rem"
            footerButtons={
                <>
                    <Button variant="white" onClick={onClose}>
                        {t("common.close")}
                    </Button>
                    <Button variant="secondary" to="/profile/personal-access-tokens">
                        {t("components.communityMcpModal.tokenButton")}
                    </Button>
                </>
            }
        >
            <div className="space-y-4 text-[13px] text-zinc-600 dark:text-zinc-300">
                <p>{t("components.communityMcpModal.start")}</p>
                <code className="block rounded-md border border-zinc-200 bg-zinc-900 px-3 py-2 font-mono text-[13px] text-green-400 dark:border-as-line dark:bg-as-bg">
                    {STACK_START_COMMAND}
                </code>
                <p>{t("components.communityMcpModal.url")}</p>
                <p>{t("components.communityMcpModal.token")}</p>
            </div>
        </Modal>
    );
};

export default CommunityMcpModal;
