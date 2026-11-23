import React from 'react';
import { cn } from '@/utils/function/utils';
import { AS_PAGE_TITLE } from '@/components/atoms/appsec/styles';

interface PageHeaderProps {
    /** Page title */
    title: string;
    /** Optional description */
    description?: string;
    /** Icon to display */
    icon?: React.ReactNode;
    /** Icon background color class */
    iconBgColor?: string;
    /** Actions to display on the right side */
    actions?: React.ReactNode;
    /** Additional className */
    className?: string;
    /** Breadcrumbs or back navigation */
    navigation?: React.ReactNode;
    /** Badge or status indicator next to title */
    badge?: React.ReactNode;
}

/**
 * Unified PageHeader component for consistent page headers across the application.
 * Follows the modern design pattern of the closed areas' page templates.
 */
const PageHeader: React.FC<PageHeaderProps> = ({
    title,
    description,
    icon,
    iconBgColor = 'bg-primary/10 dark:bg-primary/20 border-primary/20 dark:border-primary/30',
    actions,
    className,
    navigation,
    badge,
}) => {
    return (
        <div className={cn('mb-6', className)}>
            {/* Navigation (breadcrumbs or back button) */}
            {navigation && (
                <div className="mb-4">
                    {navigation}
                </div>
            )}

            {/* Main header content */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                    {/* Icon */}
                    {icon && (
                        <div className={cn(
                            // The caller's glyph at 20 px, whatever size it was given.
                            'flex h-10 w-10 items-center justify-center rounded-lg border shrink-0 [&_svg]:h-5 [&_svg]:w-5',
                            iconBgColor
                        )}>
                            {icon}
                        </div>
                    )}

                    {/* Title and description */}
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className={AS_PAGE_TITLE}>
                                {title}
                            </h1>
                            {badge}
                        </div>
                        {description && (
                            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                                {description}
                            </p>
                        )}
                    </div>
                </div>

                {/* Actions */}
                {actions && (
                    <div className="flex items-center gap-2 shrink-0">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Simple page header variant without icon
 */
export const PageHeaderSimple: React.FC<{
    title: string;
    description?: string;
    actions?: React.ReactNode;
    className?: string;
}> = ({ title, description, actions, className }) => (
    <div className={cn('flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6', className)}>
        <div>
            <h1 className={AS_PAGE_TITLE}>{title}</h1>
            {description && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{description}</p>
            )}
        </div>
        {actions && (
            <div className="flex items-center gap-2 shrink-0">
                {actions}
            </div>
        )}
    </div>
);

export default PageHeader;
