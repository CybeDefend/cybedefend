import React from 'react';

import { useTranslation } from 'react-i18next';
import { Clock } from '@/components/atoms/icon/icons';

interface ComingSoonOverlayProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  roadmapUrl?: string;
  minHeight?: 'sm' | 'md' | 'lg';
}

const ComingSoonOverlay: React.FC<ComingSoonOverlayProps> = ({ 
  children, 
  title,
  subtitle,
  roadmapUrl = "https://cybedefend.featurebase.app/en/roadmap",
  minHeight = 'md'
}) => {
  const { t } = useTranslation();
  
  const defaultTitle = t('components.comingSoon.title');
  const defaultSubtitle = t('components.comingSoon.subtitle');
  
  const minHeightClasses = {
    sm: 'min-h-[50px]',
    md: 'min-h-[100px]',
    lg: 'min-h-[150px]'
  };

  return (
    <div className="relative w-full">
      {}
      <div className={`relative ${minHeightClasses[minHeight]} filter blur-[2px]`}>
        {children}
      </div>

      {}
      <div className={`absolute inset-0 flex flex-col items-center justify-center p-4 ${minHeightClasses[minHeight]} bg-white/60 backdrop-blur-[2px] dark:bg-as-bg/60`}>
        <div className="flex flex-col items-center text-center space-y-2 z-10">
          <Clock className="w-4 h-4 text-zinc-600 dark:text-zinc-400 animate-pulse"  />
          <h3 className="text-[15px] font-medium text-zinc-900 dark:text-zinc-100">
            {title || defaultTitle}
          </h3>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
            {subtitle || defaultSubtitle}
          </p>
          {roadmapUrl && (
            <a 
              href={roadmapUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="mt-2 text-[13px] font-medium text-secondary hover:underline dark:text-secondary-light"
            >
              {t('components.comingSoon.viewRoadmap')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComingSoonOverlay;
