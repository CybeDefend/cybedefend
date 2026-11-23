import React, { useState } from 'react';

import { cn } from '@/utils/function/utils';

/**
 * The account's picture in a zinc-kit shell (the avatar is the only image of
 * the account menu). Without a picture, or when it fails to
 * load, the initial on a zinc disc — the shared `Avatar` atom paints it on the
 * accent in bold, which this space does not do.
 *
 * Decorative by default (the name is written beside it); `labelled` names it
 * when it stands alone.
 */
export interface AccountAvatarProps {
  src?: string | null;
  name: string;
  size?: 'sm' | 'md';
  labelled?: boolean;
  className?: string;
}

const SIZE = { sm: 'h-7 w-7 text-[11px]', md: 'h-8 w-8 text-xs' } as const;

const AccountAvatar: React.FC<AccountAvatarProps> = ({ src, name, size = 'md', labelled = false, className }) => {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={labelled ? name : ''}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-full object-cover', SIZE[size], className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium',
        'bg-zinc-200 text-zinc-700 dark:bg-white/[0.08] dark:text-zinc-200',
        SIZE[size],
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
};

export default AccountAvatar;
