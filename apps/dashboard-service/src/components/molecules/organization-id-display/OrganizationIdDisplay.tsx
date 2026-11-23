import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from 'react-toastify';
import { Check, Copy } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';
import { AS_FOCUS, AS_TOUCH_SQUARE } from '@/components/atoms/appsec/styles';
import { copyText } from '@/utils/copyText';

interface OrganizationIdDisplayProps {
    organizationId: string;
    organizationName?: string;
}

const OrganizationIdDisplay: React.FC<OrganizationIdDisplayProps> = ({
    organizationId,
    organizationName,
}) => {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    const copyOrganizationId = async () => {
        if (await copyText(organizationId)) {
            setCopied(true);
            toast.success(t('components.appShell.orgIdCopied'));

            // Reset the copied state after 2 seconds
            setTimeout(() => {
                setCopied(false);
            }, 2000);
        } else {
            toast.error(t('components.appShell.orgIdCopyFailed'));
        }
    };

    return (
        <div className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-mono text-xs text-zinc-700 dark:border-as-line dark:bg-white/[0.03] dark:text-zinc-300">
            <div className="flex min-w-0 flex-col sm:flex-row sm:items-center gap-x-2 gap-y-0.5">
                <span className="text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{t('components.appShell.orgId')}</span>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-mono text-zinc-800 dark:text-zinc-200 truncate">{organizationId}</span>
                    <button
                        onClick={copyOrganizationId}
                        className={cn("relative flex-shrink-0 rounded-md p-1 text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200", AS_FOCUS, AS_TOUCH_SQUARE)}
                        title={t('components.appShell.copyOrgId')}
                    >
                        {copied ? (
                            <Check className="w-4 h-4 text-green-600"  />
                        ) : (
                            <Copy className="w-4 h-4"  />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OrganizationIdDisplay;
