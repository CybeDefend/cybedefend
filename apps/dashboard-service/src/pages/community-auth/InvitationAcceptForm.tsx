import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import Input from '@/components/atoms/input/Input';
import { acceptInvitation, INVITATION_TOKEN_PATTERN } from '@/edition/auth/community/authApi';
import { adoptToken } from '@/edition/auth/community/communityAuthClient';
import { clearInvitationContext, setNewlyJoinedOrgId } from '@/server/store/invitationSlice';
import { clearInviteEmail } from '@/lib/invite-email';
import { AuthAlert, AuthFrame, AuthLink, passwordFitsPolicy } from './AuthFrame';
import { AUTH_REFUSAL_KEYS, authRefusalKey } from './authRefusals';

/**
 * `/invite#token=…` (or the former `/invite/:token`) for a signed-out visitor
 * of the Community Edition: creates the account that accepts the invitation.
 * An invitee who already has an account signs in, and comes back to the
 * invitation (`returnTo=/invite`: its token stays in memory, never in the
 * sign-in URL), where the signed-in flow accepts it.
 */
const InvitationAcceptForm: React.FC<{ token: string }> = ({ token }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [alertKey, setAlertKey] = useState<string | null>(null);

  const wellFormed = INVITATION_TOKEN_PATTERN.test(token);
  // Back to `/invite`, never to a URL holding the token: the token waits in
  // this page's memory (`invite-token.ts`), both link forms alike.
  const signInHere = `/login?returnTo=${encodeURIComponent('/invite')}`;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !wellFormed) return;
    if (!passwordFitsPolicy(password)) {
      setAlertKey('pages.communityAuth.passwordLength');
      return;
    }
    setBusy(true);
    setAlertKey(null);
    try {
      const answer = await acceptInvitation(token, { name: name.trim(), password });
      if (answer.organizationId) dispatch(setNewlyJoinedOrgId(answer.organizationId));
      dispatch(clearInvitationContext());
      clearInviteEmail();
      adoptToken(answer.accessToken, answer.expiresIn);
      navigate('/', { replace: true });
    } catch (error) {
      setAlertKey(authRefusalKey(error));
      setBusy(false);
    }
  };

  const title = t('pages.communityAuth.invitation.title');

  if (!wellFormed) {
    return (
      <AuthFrame title={title}>
        <AuthAlert>{t(AUTH_REFUSAL_KEYS.INVITATION_INVALID)}</AuthAlert>
        <p className="text-sm">
          <AuthLink to="/login">{t('pages.communityAuth.backToLogin')}</AuthLink>
        </p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title={title} subtitle={t('pages.communityAuth.invitation.subtitle')}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Input
          id="community-invitation-name"
          label={t('pages.communityAuth.fields.name')}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          id="community-invitation-password"
          label={t('pages.communityAuth.fields.password')}
          type="password"
          autoComplete="new-password"
          hint={t('pages.communityAuth.passwordHint')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {alertKey && <AuthAlert>{t(alertKey)}</AuthAlert>}
        <Button type="submit" variant="secondary" size="lg" fullWidth disabled={busy}>
          {busy ? t('pages.communityAuth.invitation.submitting') : t('pages.communityAuth.invitation.submit')}
        </Button>
      </form>
      <p className="text-sm">
        <AuthLink to={signInHere}>{t('pages.communityAuth.invitation.signIn')}</AuthLink>
      </p>
    </AuthFrame>
  );
};

export default InvitationAcceptForm;
