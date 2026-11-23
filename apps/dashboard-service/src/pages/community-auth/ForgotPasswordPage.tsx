import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import Input from '@/components/atoms/input/Input';
import { getSetupStatus, requestPasswordReset } from '@/edition/auth/community/authApi';
import { AuthAlert, AuthFrame, AuthLink, AuthNotice } from './AuthFrame';
import { authRefusalKey } from './authRefusals';

type Mode = 'loading' | 'form' | 'administrator';

/**
 * `/forgot-password`: asks for a reset link. The answer is the same sentence
 * whatever the e-mail (the server answers 202 for any address). An instance
 * that sends no e-mail says to ask an administrator instead of a form.
 */
const ForgotPasswordPage: React.FC = () => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('loading');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [refusalKey, setRefusalKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSetupStatus().then(
      (status) => {
        if (!cancelled) setMode(status.passwordResetByEmail ? 'form' : 'administrator');
      },
      // Unknown: the form stays, and the server answers the same 202.
      () => {
        if (!cancelled) setMode('form');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusalKey(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (error) {
      setRefusalKey(authRefusalKey(error));
    } finally {
      setBusy(false);
    }
  };

  const back = <AuthLink to="/login">{t('pages.communityAuth.backToLogin')}</AuthLink>;

  if (mode === 'loading') {
    return <AuthFrame title={t('pages.communityAuth.forgot.title')}>{t('pages.communityAuth.loading')}</AuthFrame>;
  }

  if (mode === 'administrator') {
    return (
      <AuthFrame title={t('pages.communityAuth.forgot.title')}>
        <AuthNotice>{t('pages.communityAuth.forgot.byAdministrator')}</AuthNotice>
        <p className="text-sm">{back}</p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title={t('pages.communityAuth.forgot.title')} subtitle={t('pages.communityAuth.forgot.subtitle')}>
      {sent ? (
        <AuthNotice>{t('pages.communityAuth.forgot.sent')}</AuthNotice>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Input
            id="community-forgot-email"
            label={t('pages.communityAuth.fields.email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {refusalKey && <AuthAlert>{t(refusalKey)}</AuthAlert>}
          <Button type="submit" variant="secondary" size="lg" fullWidth disabled={busy}>
            {busy ? t('pages.communityAuth.forgot.submitting') : t('pages.communityAuth.forgot.submit')}
          </Button>
        </form>
      )}
      <p className="text-sm">{back}</p>
    </AuthFrame>
  );
};

export default ForgotPasswordPage;
