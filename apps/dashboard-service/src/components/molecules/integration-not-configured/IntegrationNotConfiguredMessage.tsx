import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  integrationNotConfiguredKey,
  type UnconfiguredIntegration,
} from '@/server/services/integrations/integrationNotConfigured';

/** The « Optional integrations » section of the public self-hosting guide. */
export const OPTIONAL_INTEGRATIONS_GUIDE_URL =
  'https://github.com/CybeDefend/cybedefend/blob/main/deploy/community/README.md#optional-integrations';

/**
 * The body of the notice shown when an integration has no credentials on this
 * instance: the sentence naming it, then a link to the section of the guide
 * that explains how to set it up.
 */
const IntegrationNotConfiguredMessage: React.FC<{ provider: UnconfiguredIntegration }> = ({ provider }) => {
  const { t } = useTranslation();
  return (
    <span>
      {t(integrationNotConfiguredKey(provider))}{' '}
      <a href={OPTIONAL_INTEGRATIONS_GUIDE_URL} target="_blank" rel="noopener noreferrer" className="underline">
        {t('components.integrationNotConfigured.guideLink')}
      </a>
    </span>
  );
};

export default IntegrationNotConfiguredMessage;
