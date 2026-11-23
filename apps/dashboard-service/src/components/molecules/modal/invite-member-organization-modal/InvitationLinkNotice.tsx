import React, { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/atoms/copy-button';
import { sensitive } from '@/utils/privacy/sensitive';

/** An invitation token, as global-management issues it: 32 random bytes in hex. */
const INVITATION_TOKEN = /^[0-9a-f]{64}$/;

/**
 * The link an invitee opens to join (`/invite#token=<token>`), or null when the
 * token is empty (the mail went out) or not one global-management issues. The
 * token is a credential: it is never stored, never logged, and only ever ends
 * up in this link, shown once, in its fragment, which no server receives (no
 * access log, no `Referer`). The invitation page drops it from the address bar.
 */
export function invitationLink(token: string, origin?: string): string | null {
  if (typeof token !== 'string' || !INVITATION_TOKEN.test(token)) return null;
  return `${origin ?? window.location.origin}/invite#token=${token}`;
}

/**
 * Shown when no invitation mail was sent (no SMTP configured): the link, a copy
 * button, and the sentence that the administrator sends it themselves. Nothing
 * keeps it once the modal closes.
 */
export function InvitationLinkNotice({ email, token }: { email: string; token: string }): ReactElement | null {
  const { t } = useTranslation();
  const link = invitationLink(token);
  if (!link) return null;

  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/[0.03]"
    >
      <p className="mb-2 text-[13px] text-zinc-700 dark:text-zinc-300">
        {t('components.modal.inviteMember.link.noMailSent', { email })}
      </p>
      <div className="flex items-center gap-2">
        <code {...sensitive('secret')} className="min-w-0 flex-1 break-all rounded-md bg-white px-2 py-1 font-mono text-xs text-zinc-900 dark:bg-black/30 dark:text-zinc-100">
          {link}
        </code>
        <CopyButton
          text={link}
          label={t('components.modal.inviteMember.link.copy')}
          copiedLabel={t('components.modal.inviteMember.link.copied')}
          errorMessage={t('components.modal.inviteMember.link.copyFailed')}
        />
      </div>
    </div>
  );
}

export default InvitationLinkNotice;
