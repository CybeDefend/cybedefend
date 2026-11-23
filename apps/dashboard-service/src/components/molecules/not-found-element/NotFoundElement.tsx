import React, { ReactNode } from 'react';
import { Search } from '@/components/atoms/icon/icons';
import type { IconProps } from '@/components/atoms/icon/icons';

import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import Button from '@/components/atoms/button/Button';

/** Any icon from the registry: a component taking the shared icon props. */
type IconComponent = React.ComponentType<IconProps>;

interface NotFoundElementProps {
  icon?: ReactNode | IconComponent;
  title?: string;
  description?: string;
  buttonText?: string;
  onShowAll?: () => void;
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Hide the icon */
  hideIcon?: boolean;
}

const sizeClasses = {
  sm: {
    container: 'px-6 py-8',
    iconWrapper: 'p-3 mb-3',
    icon: 'h-5 w-5',
    title: 'text-base',
    description: 'text-sm',
  },
  md: {
    container: 'px-6 py-12',
    iconWrapper: 'p-3 mb-4',
    icon: 'h-6 w-6',
    title: 'text-lg',
    description: 'text-sm',
  },
  lg: {
    container: 'px-6 py-16',
    iconWrapper: 'p-3 mb-4',
    icon: 'h-6 w-6',
    title: 'text-lg',
    description: 'text-sm',
  },
};

/**
 * Modern NotFoundElement for empty search results or missing content
 */
const NotFoundElement: React.FC<NotFoundElementProps> = ({
  icon,
  title,
  description,
  buttonText,
  onShowAll,
  className = "",
  size = 'md',
  hideIcon = false,
}) => {
  const { t } = useTranslation();
  const defaultTitle = title || t('components.notFoundElement.title');
  const defaultDescription = description || t('components.notFoundElement.description');
  const defaultButtonText = buttonText || t('common.showAll');

  const sizes = sizeClasses[size];

  const defaultIcon = (
    <Search
      className={cn(sizes.icon, 'text-zinc-400 dark:text-zinc-500')}
      strokeWidth={1.5}
    />
  );

  const renderedIcon = icon
    ? typeof icon === 'function'
      ? React.createElement(icon, {
        className: cn(sizes.icon, 'text-zinc-400 dark:text-zinc-500'),
        strokeWidth: 1.5
      })
      : icon
    : defaultIcon;

  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center',
      sizes.container,
      className
    )}>
      {!hideIcon && (
        <div className={cn(
          'rounded-xl bg-zinc-100 dark:bg-white/[0.06]',
          sizes.iconWrapper
        )}>
          {renderedIcon}
        </div>
      )}
      <h3 className={cn(
        'font-semibold tracking-[-0.01em] mb-2 text-zinc-900 dark:text-zinc-50',
        sizes.title
      )}>
        {defaultTitle}
      </h3>
      <p className={cn(
        'text-zinc-500 dark:text-zinc-400 max-w-sm',
        sizes.description,
        onShowAll ? 'mb-4' : ''
      )}>
        {defaultDescription}
      </p>
      {onShowAll && (
        <Button
          variant="secondary"
          size={size === 'sm' ? 'sm' : 'md'}
          onClick={onShowAll}
        >
          {defaultButtonText}
        </Button>
      )}
    </div>
  );
};

export default NotFoundElement;