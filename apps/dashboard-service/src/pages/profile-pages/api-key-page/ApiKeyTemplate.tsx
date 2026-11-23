

import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ProfileTemplateWrapper from "../../../components/molecules/wrapper/ProfileWrapper";
import Button from "../../../components/atoms/button/Button";
import Card from "../../../components/atoms/card/Card";
import { AlertTriangle, ArrowRight } from '@/components/atoms/icon/icons';

interface ApiKeyTemplateProps {
  user: {
    firstName: string;
    lastName: string;
    email: string;
    picture: string;
  };
  authLoading: boolean;
}

const ApiKeyTemplate: React.FC<ApiKeyTemplateProps> = ({ user, authLoading }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <ProfileTemplateWrapper user={user} selectedTab="api-key" loading={authLoading}>
      <Card variant="default" padding="large">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30 mb-6">
            <AlertTriangle
              className="h-8 w-8 text-amber-600 dark:text-amber-400"
             />
          </div>

          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            {t('pages.apiKeyPage.deprecated.title')}
          </h2>

          <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md mb-8">
            {t('pages.apiKeyPage.deprecated.message')}
          </p>

          <Button
            variant="secondary"
            to="/profile/personal-access-tokens"
          >
            <span className="flex items-center gap-2">
              {t('pages.apiKeyPage.deprecated.goToPat')}
              <ArrowRight className="h-5 w-5"  />
            </span>
          </Button>
        </div>
      </Card>
    </ProfileTemplateWrapper>
  );
};

export default ApiKeyTemplate;
