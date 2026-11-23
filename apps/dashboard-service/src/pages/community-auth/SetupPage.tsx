import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import Input from '@/components/atoms/input/Input';
import { getSetupStatus, setupInstance } from '@/edition/auth/community/authApi';
import { adoptToken } from '@/edition/auth/community/communityAuthClient';
import { AuthAlert, AuthFrame, passwordFitsPolicy } from './AuthFrame';
import { authRefusalOf, authRefusalKey } from './authRefusals';

/**
 * `/setup`: the instance's first administrator and organisation, with the
 * setup token of the server's environment. Once setup is closed, the page
 * sends to `/login`.
 */
const SetupPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [setupToken, setSetupToken] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [alertKey, setAlertKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSetupStatus().then(
      (status) => {
        if (cancelled) return;
        if (!status.setupOpen) navigate('/login', { replace: true });
        else setReady(true);
      },
      // The status could not be read: the form stays, the server decides.
      () => {
        if (!cancelled) setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!passwordFitsPolicy(password)) {
      setAlertKey('pages.communityAuth.passwordLength');
      return;
    }
    setBusy(true);
    setAlertKey(null);
    try {
      const answer = await setupInstance({
        setupToken,
        email: email.trim(),
        name: name.trim(),
        password,
        organizationName: organizationName.trim(),
      });
      adoptToken(answer.accessToken, answer.expiresIn);
      navigate('/', { replace: true });
    } catch (error) {
      if (authRefusalOf(error) === 'SETUP_CLOSED') {
        navigate('/login', { replace: true });
        return;
      }
      setAlertKey(authRefusalKey(error));
      setBusy(false);
    }
  };

  if (!ready) {
    return <AuthFrame title={t('pages.communityAuth.setup.title')}>{t('pages.communityAuth.loading')}</AuthFrame>;
  }

  return (
    <AuthFrame title={t('pages.communityAuth.setup.title')} subtitle={t('pages.communityAuth.setup.subtitle')}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Input
          id="community-setup-token"
          label={t('pages.communityAuth.fields.setupToken')}
          type="password"
          autoComplete="off"
          hint={t('pages.communityAuth.setup.setupTokenHint')}
          value={setupToken}
          onChange={(e) => setSetupToken(e.target.value)}
        />
        <Input
          id="community-setup-organization"
          label={t('pages.communityAuth.fields.organizationName')}
          autoComplete="organization"
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
        />
        <Input
          id="community-setup-name"
          label={t('pages.communityAuth.fields.name')}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          id="community-setup-email"
          label={t('pages.communityAuth.fields.email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          id="community-setup-password"
          label={t('pages.communityAuth.fields.password')}
          type="password"
          autoComplete="new-password"
          hint={t('pages.communityAuth.passwordHint')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {alertKey && <AuthAlert>{t(alertKey)}</AuthAlert>}
        <Button type="submit" variant="secondary" size="lg" fullWidth disabled={busy}>
          {busy ? t('pages.communityAuth.setup.submitting') : t('pages.communityAuth.setup.submit')}
        </Button>
      </form>
    </AuthFrame>
  );
};

export default SetupPage;
