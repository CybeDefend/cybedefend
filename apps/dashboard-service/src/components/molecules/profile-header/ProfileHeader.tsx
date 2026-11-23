import React, { useState, useEffect } from 'react';
import { cn } from '@/utils/function/utils';
import { AS_AVATAR_FALLBACK } from '@/components/atoms/appsec/recipes';

interface ProfileHeaderProps {
  title: string;
  subtitle: string;
  imageUrl?: string;
  secondarySubtitle?: string;
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  title,
  subtitle,
  imageUrl,
  secondarySubtitle,
}) => {
  const [imageError, setImageError] = useState(false);

  const initials = title
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // A new picture deserves a fresh attempt, even if the previous one failed.
  useEffect(() => {
    setImageError(false);
  }, [imageUrl]);

  return (
    <div className="p-4 sm:p-6 flex items-center space-x-4 bg-white dark:bg-as-surface">
      {/*
        Plain <img>: no `crossOrigin`, no cache-busting query. The picture
        comes from the identity provider, and Google's lh3 sends no
        Access-Control-Allow-Origin: a CORS-mode request is blocked (the
        header showed the initials instead) and its pixels cannot be read
        either. The `?ts=` suffix only defeated the browser cache.
      */}
      {imageUrl && !imageError ? (
        <img
          src={imageUrl}
          alt={title}
          className="w-12 h-12 rounded-full object-cover"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className={cn(AS_AVATAR_FALLBACK, "w-12 h-12 text-base")}>
          {initials}
        </div>
      )}
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        {secondarySubtitle && (
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
            {secondarySubtitle}
          </p>
        )}
      </div>
    </div>
  );
};

export default ProfileHeader;
