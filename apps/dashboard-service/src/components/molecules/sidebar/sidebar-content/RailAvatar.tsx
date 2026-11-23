import React, { useState } from 'react';

import { cn } from '@/utils/function/utils';

import { initialsOf } from './initials';

interface RailAvatarProps {
  /** The picture, when there is one; a picture that fails to load gives way to the initials. */
  src?: string | null;
  name: string;
  className?: string;
}

/**
 * A 24 px disc on the navy rail:
 * the picture when there is one, else the initials on a quiet white-8 % fill
 * with a hairline, never the accent (a disc is not a place for it).
 * Decorative: the name is written beside it, so the image has no text and
 * the initials are hidden from assistive technology.
 */
const RailAvatar: React.FC<RailAvatarProps> = ({ src, name, className }) => {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn('h-6 w-6 shrink-0 rounded-full object-cover', className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full bg-white/[0.08] text-[10px] font-medium leading-none text-zinc-100 ring-1 ring-inset ring-white/[0.08]',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
};

export default RailAvatar;
