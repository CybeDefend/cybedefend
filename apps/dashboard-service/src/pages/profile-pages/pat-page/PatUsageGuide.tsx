import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Card from '../../../components/atoms/card/Card';
import { Book, ChevronDown, ChevronUp } from '@/components/atoms/icon/icons';

import { AS_FOCUS_INSET, AS_PANEL_TITLE } from '@/components/atoms/appsec/styles';
import { AS_GLYPH, AS_GLYPH_BOX } from '@/components/atoms/appsec/recipes';
import { cn } from '@/utils/function/utils';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import { EDITION } from '@/edition/edition';
import { patApiBaseUrl } from './patApiBaseUrl';
const PatUsageGuide: React.FC = () => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const logtoEndpoint = import.meta.env.VITE_LOGTO_ENDPOINT || 'https://your-logto-endpoint';
  const apiResource = import.meta.env.VITE_LOGTO_API_RESOURCE || 'https://your-api-resource';
  const apiBaseUrl = patApiBaseUrl({
    envUrl: import.meta.env.VITE_API_BASE_URL,
    editionUrl: ACTIVE_EXTENSIONS.publicApiUrl,
    origin: window.location.origin,
  });

  const clientIdSnippet = `curl --request GET \\
  --url ${apiBaseUrl}/client-apps`;

  const clientIdResponse = `{
  "cli": { "appId": "YOUR_CLI_APP_ID" },
  "vscode": { "appId": "YOUR_VSCODE_APP_ID" },
  "intellij": { "appId": "YOUR_INTELLIJ_APP_ID" }
}`;

  const exchangeSnippet = `curl -X POST '${logtoEndpoint}/oidc/token' \\
  -H 'Content-Type: application/x-www-form-urlencoded' \\
  -d 'client_id=APP_ID_FROM_STEP_1' \\
  -d 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \\
  -d 'subject_token=pat_YOUR_TOKEN_HERE' \\
  -d 'subject_token_type=urn:logto:token-type:personal_access_token' \\
  -d 'resource=${apiResource}'`;

  const usageSnippet = `curl -X GET '${apiResource}/user/profile' \\
  -H 'Authorization: Bearer ACCESS_TOKEN_FROM_STEP_2'`;

  // The Community Edition's token is a bearer itself: no client id, no exchange.
  const isCommunity = EDITION === 'community';
  const communitySnippet = `curl -X GET '${apiBaseUrl}/user/profile' \\
  -H 'Authorization: Bearer cdp_YOUR_TOKEN_HERE'`;

  return (
    <Card variant="default" padding="none" className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn("w-full flex items-center justify-between px-4 py-3 sm:px-5 sm:py-4 text-left hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors duration-[120ms]", AS_FOCUS_INSET)}
      >
        <div className="flex items-center gap-3">
          <div className={AS_GLYPH_BOX}>
            <Book className={AS_GLYPH}  />
          </div>
          <div>
            <h3 className={AS_PANEL_TITLE}>
              {t('components.patUsageGuide.title')}
            </h3>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t('components.patUsageGuide.intro')}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp
          className="h-4 w-4 text-zinc-400 dark:text-zinc-500 shrink-0 ml-4" /> : <ChevronDown
          className="h-4 w-4 text-zinc-400 dark:text-zinc-500 shrink-0 ml-4" />}
      </button>

      {expanded && isCommunity && (
        <div className="px-4 pb-5 sm:px-5 space-y-6 border-t border-zinc-200 dark:border-as-line pt-4">
          <div>
            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
              {t('components.patUsageGuide.community.stepTitle')}
            </h4>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-3">
              {t('components.patUsageGuide.community.stepDescription')}
            </p>
            <pre className="bg-zinc-900 dark:bg-as-bg text-green-400 text-xs p-4 rounded-lg border border-zinc-200 dark:border-as-line overflow-x-auto">
              <code>{communitySnippet}</code>
            </pre>
          </div>
          <div>
            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
              {t('components.patUsageGuide.community.notesTitle')}
            </h4>
            <ul className="space-y-2">
              {['note1', 'note2', 'note3'].map((noteKey) => (
                <li key={noteKey} className="text-[13px] text-zinc-600 dark:text-zinc-400">
                  {t(`components.patUsageGuide.community.${noteKey}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {expanded && !isCommunity && (
        <div className="px-4 pb-5 sm:px-5 space-y-6 border-t border-zinc-200 dark:border-as-line pt-4">
          {/* Step 1 - Get client ID */}
          <div>
            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
              {t('components.patUsageGuide.step1Title')}
            </h4>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-3">
              {t('components.patUsageGuide.step1Description')}
            </p>
            <pre className="bg-zinc-900 dark:bg-as-bg text-green-400 text-xs p-4 rounded-lg border border-zinc-200 dark:border-as-line overflow-x-auto">
              <code>{clientIdSnippet}</code>
            </pre>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 mb-1">{t('components.patUsageGuide.response')}</p>
            <pre className="bg-zinc-900 dark:bg-as-bg text-green-400 text-xs p-4 rounded-lg border border-zinc-200 dark:border-as-line overflow-x-auto">
              <code>{clientIdResponse}</code>
            </pre>
          </div>

          {/* Step 2 - Exchange PAT */}
          <div>
            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
              {t('components.patUsageGuide.step2Title')}
            </h4>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-3">
              {t('components.patUsageGuide.step2Description')}
            </p>
            <pre className="bg-zinc-900 dark:bg-as-bg text-green-400 text-xs p-4 rounded-lg border border-zinc-200 dark:border-as-line overflow-x-auto">
              <code>{exchangeSnippet}</code>
            </pre>
          </div>

          {/* Step 3 - Use access token */}
          <div>
            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
              {t('components.patUsageGuide.step3Title')}
            </h4>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-3">
              {t('components.patUsageGuide.step3Description')}
            </p>
            <pre className="bg-zinc-900 dark:bg-as-bg text-green-400 text-xs p-4 rounded-lg border border-zinc-200 dark:border-as-line overflow-x-auto">
              <code>{usageSnippet}</code>
            </pre>
          </div>

          {/* Notes */}
          <div>
            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
              {t('components.patUsageGuide.notesTitle')}
            </h4>
            <ul className="space-y-2">
              {['note1', 'note2', 'note3'].map((noteKey) => (
                <li
                  key={noteKey}
                  className="text-[13px] text-zinc-600 dark:text-zinc-400"
                >
                  {t(`components.patUsageGuide.${noteKey}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
};

export default PatUsageGuide;
