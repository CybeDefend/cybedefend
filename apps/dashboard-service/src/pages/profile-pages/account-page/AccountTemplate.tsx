import { supportUrl } from '@/edition/support';
import React from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import ProfileHeader from "../../../components/molecules/profile-header/ProfileHeader";
import SettingsTabs from "../../../components/molecules/sidebar/custom-tabs/CustomTabs";
import { RootState } from "../../../server/store";

import Card from "../../../components/atoms/card/Card";
import Toggle from "../../../components/atoms/toggle/Toggle";
import Input from "../../../components/atoms/input/Input";
import Button from "../../../components/atoms/button/Button";
import ProfileTemplateWrapper from "../../../components/molecules/wrapper/ProfileWrapper";
import { BookOpen, HelpCircle, Mail, Trash2 } from '@/components/atoms/icon/icons';

import { AS_PANEL_TITLE, AS_WELL, AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
interface AccountTemplateProps {
  email: string;
  notificationsEnabled: boolean;
  onToggleNotifications: (enabled: boolean) => void;
  onDeleteAccount: () => void;
  loading: boolean;
  /** The edition's password change, shown under the account cards (the Community Edition's form), or nothing. */
  passwordChange?: React.ReactNode;
}

const AccountTemplate: React.FC<AccountTemplateProps> = ({
  email,
  notificationsEnabled,
  onToggleNotifications,
  onDeleteAccount,
  loading,
  passwordChange = null,
}) => {
  const user = useSelector((state: RootState) => state.user);
  const { t } = useTranslation();

  return (
    <ProfileTemplateWrapper
      user={user}
      selectedTab="general"
      loading={loading}
    >
      <div className="mx-auto space-y-6">
        {}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {}
          <Card className="p-4 sm:p-6">
            <div className="flex flex-col justify-between">
              <h2 className={cn(AS_PANEL_TITLE, "mb-4")}>
                {t('pages.accountTemplate.accountInfo')}
              </h2>
              <Input
                label={t('pages.accountTemplate.emailAddress')}
                value={email}
                width="w-full"
                placeholder={t('pages.accountTemplate.emailAddress')}
                type="email"
                readOnly
              />
            </div>
          </Card>

          {}
          <Card className="p-4 sm:p-6">
            <div className="flex flex-col justify-between">
              <h2 className={cn(AS_PANEL_TITLE, "mb-4")}>
                {t('pages.accountTemplate.notifications')}
              </h2>
              <div className={cn(AS_WELL, "flex items-center justify-between gap-4 px-4 py-3")}>
                <div className="flex items-center space-x-3">
                  <Mail className="w-4 h-4 text-zinc-400 dark:text-zinc-500"  />
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t('pages.accountTemplate.emailNotifications')}
                  </span>
                </div>
                <Toggle
                  enabled={notificationsEnabled}
                  onChange={onToggleNotifications}
                />
              </div>
            </div>
          </Card>
        </section>

        {passwordChange && <section>{passwordChange}</section>}

        {}
        <section>
          <Card className="p-4 sm:p-6">
            <h2 className={cn(AS_PANEL_TITLE, "mb-4")}>
              {t('pages.accountTemplate.support.title')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {}
              <div className={cn(AS_WELL, "flex items-start space-x-3 p-4")}>
                <BookOpen className="w-4 h-4 mt-0.5 flex-shrink-0 text-zinc-500 dark:text-zinc-400"  />
                <div>
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t('pages.accountTemplate.support.documentation.title')}
                  </h3>
                  <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5 mb-3">
                    {t('pages.accountTemplate.support.documentation.description')}
                  </p>
                  {/* A way out to the docs, not the page's action: no violet fill (one accent per screen). */}
                  <Button
                    variant="white"
                    onClick={() =>
                      window.open("https://docs.cybedefend.com", "_blank")
                    }
                  >
                    {t('pages.accountTemplate.support.documentation.button')}
                  </Button>
                </div>
              </div>

              {}
              <div className={cn(AS_WELL, "flex items-start space-x-3 p-4")}>
                <HelpCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-zinc-500 dark:text-zinc-400"  />
                <div>
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t('pages.accountTemplate.support.contact.title')}
                  </h3>
                  <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5 mb-3">
                    {t('pages.accountTemplate.support.contact.description')}
                  </p>
                  <a
                    href={supportUrl()}
                    className={cn("relative text-[13px] font-medium text-secondary dark:text-secondary-light hover:underline", AS_FOCUS, AS_TOUCH)}
                  >
                    {t('pages.notFound.actions.needHelp.button')}
                  </a>
                </div>
              </div>
            </div>
          </Card>
        </section>

        {}
        {/* <section className="bg-white dark:bg-neutral-800 p-8 rounded-lg shadow border border-red-500">
        <h2 className="text-2xl font-bold mb-4 text-red-600">Delete Account</h2>
        <p className="text-black dark:text-gray-300 mb-4">
          Deleting your account will remove all your data from CybeDefend. This action cannot be undone.
          If you're part of any organizations, please ensure to transfer ownership or inform the administrators before proceeding.
        </p>
        <Button variant="red" onClick={onDeleteAccount}>
          <Trash2 className="w-5 h-5 mr-2"  />
          Delete My Account
        </Button>
      </section> */}
      </div>
    </ProfileTemplateWrapper>
  );
};

export default AccountTemplate;
