import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import Input from '@/components/atoms/input/Input';
import { getSetupStatus, signUp } from '@/edition/auth/community/authApi';
import { adoptToken } from '@/edition/auth/community/communityAuthClient';
import { AuthAlert, AuthFrame, AuthLink, passwordFitsPolicy } from './AuthFrame';
import { authRefusalOf, authRefusalKey, type AuthRefusal } from './authRefusals';

/**
 * `/signup`, served only while the instance's sign-up is open and its setup
 * is closed; otherwise, or when that cannot be read, it sends to `/login`.
 */
const SignUpPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [alertKey, setAlertKey] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<AuthRefusal | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSetupStatus().then(
      (status) => {
        if (cancelled) return;
        if (status.signupMode === 'open' && !status.setupOpen) setReady(true);
        else navigate('/login', { replace: true });
      },
      () => {
        if (!cancelled) navigate('/login', { replace: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setRefusal(null);
    if (!passwordFitsPolicy(password)) {
      setAlertKey('pages.communityAuth.passwordLength');
      return;
    }
    setBusy(true);
    setAlertKey(null);
    try {
      const answer = await signUp({ email: email.trim(), name: name.trim(), password });
      adoptToken(answer.accessToken, answer.expiresIn);
      navigate('/', { replace: true });
    } catch (error) {
      setRefusal(authRefusalOf(error));
      setAlertKey(authRefusalKey(error));
      setBusy(false);
    }
  };

  if (!ready) {
    return <AuthFrame title={t('pages.communityAuth.signup.title')}>{t('pages.communityAuth.loading')}</AuthFrame>;
  }

  return (
    <AuthFrame title={t('pages.communityAuth.signup.title')} subtitle={t('pages.communityAuth.signup.subtitle')}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Input
          id="community-signup-name"
          label={t('pages.communityAuth.fields.name')}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          id="community-signup-email"
          label={t('pages.communityAuth.fields.email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          id="community-signup-password"
          label={t('pages.communityAuth.fields.password')}
          type="password"
          autoComplete="new-password"
          hint={t('pages.communityAuth.passwordHint')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {alertKey && <AuthAlert>{t(alertKey)}</AuthAlert>}
        {refusal === 'ACCOUNT_EXISTS' && (
          <p className="text-sm">
            <AuthLink to="/login">{t('pages.communityAuth.signup.signIn')}</AuthLink>
          </p>
        )}
        <Button type="submit" variant="secondary" size="lg" fullWidth disabled={busy}>
          {busy ? t('pages.communityAuth.signup.submitting') : t('pages.communityAuth.signup.submit')}
        </Button>
      </form>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t('pages.communityAuth.signup.haveAccount')}{' '}
        <AuthLink to="/login">{t('pages.communityAuth.signup.signIn')}</AuthLink>
      </p>
    </AuthFrame>
  );
};

export default SignUpPage;
