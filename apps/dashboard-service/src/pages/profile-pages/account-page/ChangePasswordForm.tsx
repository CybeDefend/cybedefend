import React, { type ReactElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Card from '@/components/atoms/card/Card';
import Input from '@/components/atoms/input/Input';
import Button from '@/components/atoms/button/Button';
import { AS_PANEL_TITLE } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
import { changePassword } from '@/edition/auth/community/authApi';
import { adoptToken } from '@/edition/auth/community/communityAuthClient';
import { AuthAlert, passwordFitsPolicy } from '@/pages/community-auth/AuthFrame';
import { authRefusalKey } from '@/pages/community-auth/authRefusals';

/**
 * The Community Edition's password change, on the profile's account page.
 * A success answers a new access token and
 * a rotated cookie, every other session signed out: the token is adopted and
 * a fixed sentence says so. A refusal (CURRENT_PASSWORD_INVALID among them) is
 * a fixed sentence and never ends the session. The passwords live in this
 * form's state only. Both fields are emptied once the server answers,
 * success, refusal or failure alike: the user types them again.
 */
export function ChangePasswordForm(): ReactElement {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [alertKey, setAlertKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setDone(false);
    if (currentPassword === '') {
      setAlertKey('pages.communityAuth.changePassword.currentRequired');
      return;
    }
    if (!passwordFitsPolicy(newPassword)) {
      setAlertKey('pages.communityAuth.passwordLength');
      return;
    }
    setBusy(true);
    setAlertKey(null);
    try {
      const answer = await changePassword(currentPassword, newPassword);
      adoptToken(answer.accessToken, answer.expiresIn);
      setDone(true);
    } catch (error) {
      setAlertKey(authRefusalKey(error));
    } finally {
      setCurrentPassword('');
      setNewPassword('');
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 sm:p-6">
      <h2 className={cn(AS_PANEL_TITLE, 'mb-1')}>{t('pages.communityAuth.changePassword.title')}</h2>
      <p className="mb-4 text-[13px] text-zinc-500 dark:text-zinc-400">
        {t('pages.communityAuth.changePassword.subtitle')}
      </p>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Input
          id="community-change-password-current"
          label={t('pages.communityAuth.changePassword.current')}
          type="password"
          autoComplete="current-password"
          width="w-full"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <Input
          id="community-change-password-new"
          label={t('pages.communityAuth.fields.newPassword')}
          type="password"
          autoComplete="new-password"
          width="w-full"
          hint={t('pages.communityAuth.passwordHint')}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        {alertKey && <AuthAlert>{t(alertKey)}</AuthAlert>}
        {done && (
          <p
            role="status"
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-as-line-strong dark:bg-white/[0.03] dark:text-zinc-300"
          >
            {t('pages.communityAuth.changePassword.done')}
          </p>
        )}
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? t('pages.communityAuth.changePassword.submitting') : t('pages.communityAuth.changePassword.submit')}
        </Button>
      </form>
    </Card>
  );
}

export default ChangePasswordForm;
