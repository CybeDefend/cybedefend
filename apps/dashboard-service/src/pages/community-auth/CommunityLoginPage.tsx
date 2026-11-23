import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import Input from '@/components/atoms/input/Input';
import { getSetupStatus } from '@/edition/auth/community/authApi';
import { signInWithPassword } from '@/edition/auth/community/communityAuthClient';
import { AuthAlert, AuthFrame, AuthLink, AuthNotice } from './AuthFrame';
import { authRefusalKey } from './authRefusals';
import { safeReturnTo } from './returnTo';

/**
 * `/login` in the Community Edition: e-mail and password. An unknown e-mail
 * and a wrong password get the same sentence (the server answers one code).
 * `returnTo` is followed only through `safeReturnTo`.
 */
const CommunityLoginPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusalKey, setRefusalKey] = useState<string | null>(null);
  const [signupOpen, setSignupOpen] = useState(false);

  const signoutIncomplete = params.get('signout') === 'incomplete';

  useEffect(() => {
    let cancelled = false;
    getSetupStatus().then(
      (status) => {
        if (cancelled) return;
        if (status.setupOpen) {
          navigate('/setup', { replace: true });
          return;
        }
        setSignupOpen(status.signupMode === 'open');
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusalKey(null);
    try {
      await signInWithPassword(email.trim(), password);
      navigate(safeReturnTo(params.get('returnTo')) ?? '/', { replace: true });
    } catch (error) {
      setRefusalKey(authRefusalKey(error));
      setBusy(false);
    }
  };

  return (
    <AuthFrame title={t('pages.communityAuth.login.title')} subtitle={t('pages.communityAuth.login.subtitle')}>
      {signoutIncomplete && <AuthNotice>{t('pages.communityAuth.login.signoutIncomplete')}</AuthNotice>}
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Input
          id="community-login-email"
          label={t('pages.communityAuth.fields.email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          id="community-login-password"
          label={t('pages.communityAuth.fields.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {refusalKey && <AuthAlert>{t(refusalKey)}</AuthAlert>}
        <Button type="submit" variant="secondary" size="lg" fullWidth disabled={busy}>
          {busy ? t('pages.communityAuth.login.submitting') : t('pages.communityAuth.login.submit')}
        </Button>
      </form>
      <div className="flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <AuthLink to="/forgot-password">{t('pages.communityAuth.login.forgotPassword')}</AuthLink>
        {signupOpen && (
          <p>
            {t('pages.communityAuth.login.noAccount')}{' '}
            <AuthLink to="/signup">{t('pages.communityAuth.login.signUp')}</AuthLink>
          </p>
        )}
      </div>
    </AuthFrame>
  );
};

export default CommunityLoginPage;
