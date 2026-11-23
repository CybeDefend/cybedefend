import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import Input from '@/components/atoms/input/Input';
import { confirmPasswordReset } from '@/edition/auth/community/authApi';
import { AuthAlert, AuthFrame, AuthLink, AuthNotice, passwordFitsPolicy } from './AuthFrame';
import { AUTH_REFUSAL_KEYS, authRefusalKey } from './authRefusals';

/** The reset token's shape (the gateway's DTO: 1 to 512 characters); anything else is RESET_TOKEN_INVALID, with no request. */
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/**
 * Reads `#token=` from the address bar and drops the hash with
 * `history.replaceState` at once, before any request: the token never reaches
 * a server log, a `Referer` or the history. The window's location is read, as
 * the reset mail opens it; the router's own state is kept.
 */
function takeTokenFromHash(): string | null {
  const { hash, pathname, search } = window.location;
  if (!hash) return null;
  window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  const token = new URLSearchParams(hash.slice(1)).get('token');
  return token && RESET_TOKEN_PATTERN.test(token) ? token : null;
}

type Phase = 'reading' | 'form' | 'invalid' | 'done';

/** `/reset-password#token=…`: the new password of a reset link. */
const ResetPasswordPage: React.FC = () => {
  const { t } = useTranslation();
  // Kept across a strict-mode remount: the hash is gone after the first read.
  const tokenRef = useRef<string | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('reading');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [alertKey, setAlertKey] = useState<string | null>(null);

  useEffect(() => {
    if (tokenRef.current === undefined) tokenRef.current = takeTokenFromHash();
    setPhase(tokenRef.current ? 'form' : 'invalid');
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = tokenRef.current;
    if (busy || !token) return;
    if (!passwordFitsPolicy(password)) {
      setAlertKey('pages.communityAuth.passwordLength');
      return;
    }
    setBusy(true);
    setAlertKey(null);
    try {
      await confirmPasswordReset(token, password);
      tokenRef.current = null;
      setPhase('done');
    } catch (error) {
      setAlertKey(authRefusalKey(error));
    } finally {
      setBusy(false);
    }
  };

  const title = t('pages.communityAuth.reset.title');

  if (phase === 'reading') return <AuthFrame title={title}>{t('pages.communityAuth.loading')}</AuthFrame>;

  if (phase === 'invalid') {
    return (
      <AuthFrame title={title}>
        <AuthAlert>{t(AUTH_REFUSAL_KEYS.RESET_TOKEN_INVALID)}</AuthAlert>
        <p className="text-sm">
          <AuthLink to="/forgot-password">{t('pages.communityAuth.reset.requestNew')}</AuthLink>
        </p>
      </AuthFrame>
    );
  }

  if (phase === 'done') {
    return (
      <AuthFrame title={title}>
        <AuthNotice>{t('pages.communityAuth.reset.done')}</AuthNotice>
        <p className="text-sm">
          <AuthLink to="/login">{t('pages.communityAuth.reset.signIn')}</AuthLink>
        </p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title={title} subtitle={t('pages.communityAuth.reset.subtitle')}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Input
          id="community-reset-password"
          label={t('pages.communityAuth.fields.newPassword')}
          type="password"
          autoComplete="new-password"
          hint={t('pages.communityAuth.passwordHint')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {alertKey && <AuthAlert>{t(alertKey)}</AuthAlert>}
        <Button type="submit" variant="secondary" size="lg" fullWidth disabled={busy}>
          {busy ? t('pages.communityAuth.reset.submitting') : t('pages.communityAuth.reset.submit')}
        </Button>
      </form>
      <p className="text-sm">
        <AuthLink to="/forgot-password">{t('pages.communityAuth.reset.requestNew')}</AuthLink>
      </p>
    </AuthFrame>
  );
};

export default ResetPasswordPage;
