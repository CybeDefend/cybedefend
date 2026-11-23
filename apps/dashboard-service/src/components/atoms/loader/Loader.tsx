import React from 'react';
import { cn } from '@/utils/function/utils';

import LoaderHome from './LoaderHome';
import SpinnerArc from './SpinnerArc';

export type LoaderSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type LoaderVariant = 'default' | 'primary' | 'secondary' | 'white';

interface LoaderProps {
    /** Size of the loader */
    size?: LoaderSize;
    /** Color variant */
    variant?: LoaderVariant;
    /** Additional CSS classes */
    className?: string;
    /** Show as full page overlay */
    fullPage?: boolean;
    /** Optional loading text */
    text?: string;
    /** Show logo in full page mode */
    showLogo?: boolean;
}

const textClasses: Record<LoaderSize, string> = {
    xs: 'text-xs',
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
    xl: 'text-xl',
};

/**
 * The colour of the arc, per variant (the arc and its faint track are both
 * `currentColor`). `secondary` is the product accent: violet in AppSec, ink in
 * another product space.
 */
const variantClasses: Record<LoaderVariant, string> = {
    default: 'text-zinc-500 dark:text-zinc-400',
    primary: 'text-primary dark:text-zinc-100',
    secondary: 'text-secondary',
    white: 'text-white',
};

/**
 * Unified Loader component following atomic design principles.
 * Use this as the single source of truth for all loading indicators.
 *
 * The indicator is a short hairline arc turning calmly on a
 * faint track (`SpinnerArc`), not a bordered rotating circle; every prop and
 * size is unchanged. The full-page form with the logo is the app's full-page
 * loader (`LoaderHome`), the product's mark drawing itself.
 */
const Loader: React.FC<LoaderProps> = ({
    size = 'md',
    variant = 'secondary',
    className,
    fullPage = false,
    text,
    showLogo = false,
}) => {
    const spinnerElement = (
        <SpinnerArc
            size={size}
            className={cn(variantClasses[variant], className)}
            role="status"
            aria-label="Loading"
        />
    );

    if (fullPage) {
        if (showLogo) return <LoaderHome title={text} />;
        return (
            <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-as-bg">
                <SpinnerArc size="lg" className={variantClasses[variant]} role="status" aria-label="Loading" />
                {text && (
                    <span className="font-mono text-[12px] leading-5 text-zinc-500 dark:text-zinc-450">
                        {text}
                    </span>
                )}
            </div>
        );
    }

    if (text) {
        return (
            <div className="flex items-center gap-2">
                {spinnerElement}
                <span className={cn('text-zinc-600 dark:text-zinc-300', textClasses[size])}>
                    {text}
                </span>
            </div>
        );
    }

    return spinnerElement;
};

/**
 * Inline loader for buttons and small spaces
 */
export const LoaderInline: React.FC<{ className?: string }> = ({ className }) => (
    <Loader size="xs" variant="white" className={className} />
);

/**
 * Page section loader with centered spinner
 */
export const LoaderSection: React.FC<{ text?: string; className?: string }> = ({
    text,
    className
}) => (
    <div className={cn('flex flex-col items-center justify-center py-12', className)}>
        <Loader size="lg" variant="secondary" text={text} />
    </div>
);

/**
 * Full page loader with optional logo
 */
export const LoaderFullPage: React.FC<{ text?: string; showLogo?: boolean }> = ({
    text,
    showLogo = true
}) => (
    <Loader fullPage text={text} showLogo={showLogo} variant="secondary" />
);

export default Loader;
