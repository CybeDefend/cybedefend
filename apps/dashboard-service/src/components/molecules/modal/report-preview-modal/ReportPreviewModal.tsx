import React, { useEffect, useState } from 'react';
import SideSheet from '@/components/atoms/side-sheet/SideSheet';
import Button from '../../../atoms/button/Button';
import { useTranslation } from 'react-i18next';
import { Download } from '@/components/atoms/icon/icons';

interface ReportPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    reportContent: string;
    reportFormat: 'json' | 'html';
    reportFilename: string;
    onDownload: () => void;
    /**
     * OWASP/CWE/scanner reports no longer embed their body inline
     * (`reportContent` is always empty for them). When set, the modal fetches
     * this signed storage URL and renders the fetched text. The CSP `connect-src`
     * allowlists the storage endpoints and the bucket CORS policy allows the
     * cross-origin GET, so the fetch succeeds despite the URL's
     * `Content-Disposition: attachment` (which only affects navigation, not
     * a `fetch().text()` body read). EU AI Act / SBOM keep using the inline
     * base64 `reportContent` and pass no `downloadUrl`.
     */
    downloadUrl?: string;
}

const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({
    isOpen,
    onClose,
    reportContent,
    reportFormat,
    reportFilename,
    onDownload,
    downloadUrl,
}) => {
    const { t } = useTranslation();
    const [fetchedText, setFetchedText] = useState<string | null>(null);
    const [fetchError, setFetchError] = useState(false);

    useEffect(() => {
        if (!isOpen || !downloadUrl) {
            return;
        }

        let cancelled = false;
        setFetchedText(null);
        setFetchError(false);

        fetch(downloadUrl)
            .then((res) => {
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                return res.text();
            })
            .then((text) => {
                if (!cancelled) {
                    setFetchedText(text);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setFetchError(true);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen, downloadUrl]);

    const renderContent = () => {
        // Signed-URL path (OWASP/CWE/scanner): surface loading/error before the
        // body is available, then render the fetched text.
        if (downloadUrl) {
            if (fetchError) {
                return (
                    <div className="flex min-h-[240px] flex-1 items-center justify-center text-sm text-red-600 dark:text-red-400">
                        {t('pages.projectReports.previewError')}
                    </div>
                );
            }
            if (fetchedText === null) {
                return (
                    <div className="flex min-h-[240px] flex-1 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                        {t('pages.projectReports.previewLoading')}
                    </div>
                );
            }
        }

        // Resolve the raw report text: fetched (signed URL) or decoded inline
        // base64 (EU AI Act / SBOM).
        let text: string | null;
        if (downloadUrl) {
            text = fetchedText;
        } else {
            try {
                text = atob(reportContent);
            } catch {
                text = null;
            }
        }

        if (text === null) {
            return (
                <div className="flex min-h-[240px] flex-1 items-center justify-center text-sm text-red-600 dark:text-red-400">
                    {t('pages.projectReports.previewError')}
                </div>
            );
        }

        if (reportFormat === 'html') {
            return (
                <div className="flex min-h-[480px] flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-as-line">
                    {/* [H3] sandbox MUST stay empty: the report body is
                        template-expanded HTML and may carry inert tags that we
                        do NOT want to grant any capability to. Empty sandbox =
                        strictest policy (opaque origin, no scripts, no forms,
                        no top-nav, no same-origin). The previous
                        `allow-same-origin` value let any script reach the
                        dashboard origin via cookies. */}
                    <iframe
                        srcDoc={text}
                        className="w-full flex-1"
                        title="Report Preview"
                        sandbox=""
                    />
                </div>
            );
        }

        if (reportFormat === 'json') {
            let formattedJson = '';
            try {
                formattedJson = JSON.stringify(JSON.parse(text), null, 2);
            } catch {
                formattedJson = text;
            }

            return (
                <div className="border border-zinc-200 dark:border-as-line rounded-xl p-4 bg-zinc-50 dark:bg-white/[0.03] overflow-auto">
                    <pre className="font-mono text-xs leading-5 text-zinc-800 dark:text-zinc-300">
                        <code>{formattedJson}</code>
                    </pre>
                </div>
            );
        }

        return null;
    };

    const footerButtons = (
        <>
            <Button variant="white" onClick={onClose}>
                {t('components.button.close')}
            </Button>
            <Button
                variant="secondary"
                onClick={onDownload}
                icon={<Download size={18} />}
            >
                {t('pages.projectReports.download')}
            </Button>
        </>
    );

    // One report's content in the right-hand sheet of every record detail, wide
    // enough for a document; the file's name under the title, never after a dash.
    return (
        <SideSheet
            open={isOpen}
            onClose={onClose}
            width="xl"
            title={t('pages.projectReports.preview')}
            description={<span className="font-mono text-xs [overflow-wrap:anywhere]">{reportFilename}</span>}
            footer={footerButtons}
            bodyClassName="flex flex-col"
        >
            {renderContent()}
        </SideSheet>
    );
};

export default ReportPreviewModal;
