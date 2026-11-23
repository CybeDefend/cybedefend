import React from 'react';
import { cn } from '@/utils/function/utils';

const AVATAR_SRC = '/images/cybe-avatar.svg';

const sizeMap = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
} as const;

export type CybeAvatarSize = keyof typeof sizeMap;

interface CybeAvatarProps {
  size?: CybeAvatarSize;
  showStatus?: boolean;
  pulse?: boolean;
  className?: string;
  'data-testid'?: string;
  decorative?: boolean;
}

export const CybeAvatar: React.FC<CybeAvatarProps> = ({
  size = 'md',
  showStatus = false,
  pulse = false,
  className,
  'data-testid': testId,
  decorative = false,
}) => {
  const px = sizeMap[size];
  const badgeSize = Math.max(8, Math.round(px * 0.22));

  return (
    <div
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: px, height: px }}
      data-testid={testId}
    >
      <img
        src={AVATAR_SRC}
        alt={decorative ? '' : 'Cybe'}
        aria-hidden={decorative ? true : undefined}
        className="w-full h-full rounded-full object-cover"
        draggable={false}
      />

      {pulse && (
        <span
          data-pulse
          className="absolute inset-0 rounded-full animate-ping bg-green-400/30 pointer-events-none"
          style={{ animationDuration: '2.5s' }}
        />
      )}

      {showStatus && (
        <span
          data-status-badge
          className="absolute bottom-0 right-0 block rounded-full bg-green-500 ring-2 ring-white dark:ring-neutral-900"
          style={{ width: badgeSize, height: badgeSize }}
        />
      )}
    </div>
  );
};

export default CybeAvatar;
