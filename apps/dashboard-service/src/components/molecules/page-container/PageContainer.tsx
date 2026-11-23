import React from 'react';
import { cn } from '@/utils/function/utils';
import { AS_PANEL, AS_PANEL_TITLE } from '@/components/atoms/appsec/styles';

export type PageContainerBackground = 'default' | 'subtle' | 'transparent';

interface PageContainerProps {
    children: React.ReactNode;
    /** Background style variant */
    background?: PageContainerBackground;
    /** Additional className */
    className?: string;
    /** Max width constraint */
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' | 'none';
    /** Padding size */
    padding?: 'none' | 'sm' | 'md' | 'lg';
}

const backgroundClasses: Record<PageContainerBackground, string> = {
    default: 'bg-as-bg',
    subtle: 'bg-white dark:bg-as-surface',
    transparent: 'bg-transparent',
};

const maxWidthClasses = {
    sm: 'max-w-screen-sm',
    md: 'max-w-screen-md',
    lg: 'max-w-screen-lg',
    xl: 'max-w-screen-xl',
    '2xl': 'max-w-screen-2xl',
    full: 'max-w-full',
    none: '',
};

const paddingClasses = {
    none: 'p-0',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
};

/**
 * PageContainer - Unified container for page content
 * Provides consistent spacing, backgrounds, and max-width constraints
 */
const PageContainer: React.FC<PageContainerProps> = ({
    children,
    background = 'default',
    className,
    maxWidth = 'none',
    padding = 'md',
}) => {
    return (
        <div className={cn(
            'transition-colors duration-200',
            backgroundClasses[background],
            paddingClasses[padding],
            className
        )}>
            <div className={cn(
                'mx-auto w-full',
                maxWidthClasses[maxWidth]
            )}>
                {children}
            </div>
        </div>
    );
};

/**
 * ContentCard - A card wrapper for sections within a page
 */
export const ContentCard: React.FC<{
    children: React.ReactNode;
    className?: string;
    padding?: 'none' | 'sm' | 'md' | 'lg';
    noBorder?: boolean;
}> = ({ children, className, padding = 'md', noBorder = false }) => (
    <div className={cn(
        AS_PANEL,
        noBorder && 'border-0',
        paddingClasses[padding],
        className
    )}>
        {children}
    </div>
);

/**
 * ContentSection - A section within a page with optional title
 */
export const ContentSection: React.FC<{
    children: React.ReactNode;
    title?: string;
    description?: string;
    action?: React.ReactNode;
    className?: string;
}> = ({ children, title, description, action, className }) => (
    <section className={cn('space-y-4', className)}>
        {(title || action) && (
            <div className="flex items-center justify-between">
                <div>
                    {title && (
                        <h2 className={AS_PANEL_TITLE}>
                            {title}
                        </h2>
                    )}
                    {description && (
                        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                            {description}
                        </p>
                    )}
                </div>
                {action}
            </div>
        )}
        {children}
    </section>
);

export default PageContainer;
