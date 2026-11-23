import { cn } from '@/utils/function/utils';
import { motion } from 'framer-motion';
import { ReactNode } from 'react';
import { Inbox as InboxIcon, CircleCheck, Filter as FilterIcon } from '@/components/atoms/icon/icons';
import { CybeAvatar } from '@/components/atoms/cybe-avatar/CybeAvatar';
import { EDITION } from '@/edition/edition';

// Cybe is the cloud's AI agent: the Community Edition shows the
// neutral medallion where the cloud shows Cybe's avatar.
const SHOWS_CYBE = EDITION !== 'community';

export interface EmptyStateProps {
    /** Custom icon to display */
    icon?: ReactNode;
    /** Title text */
    title: string;
    /** Description text */
    description?: string;
    /** Action button or element */
    action?: ReactNode;
    /** Size variant */
    size?: 'sm' | 'md' | 'lg';
    /** Additional CSS classes */
    className?: string;
    /** Optional illustration image URL */
    illustration?: string;
    /** Alt text for illustration */
    illustrationAlt?: string;
    /** When true, uses CybeAvatar instead of default icon */
    cybeMessage?: boolean;
    /**
     * What the emptiness means. `positive` — nothing wrong was found;
     * `neutral` — no data yet; `warning` — a filter is hiding the content.
     * Drives the medallion's colour and its default icon.
     */
    tone?: EmptyStateTone;
}

export type EmptyStateTone = 'neutral' | 'positive' | 'warning';

/** One medallion per meaning — the convention every empty screen shares. */
const toneConfig: Record<EmptyStateTone, { classes: string; icon: ReactNode }> = {
    neutral: {
        classes: 'bg-gray-100 text-gray-400 dark:bg-white/[0.06] dark:text-zinc-400',
        icon: <InboxIcon className="h-1/2 w-1/2" />,
    },
    positive: {
        classes: 'bg-green-100 dark:bg-green-900/30 text-green-500 dark:text-green-400',
        icon: <CircleCheck className="h-1/2 w-1/2" />,
    },
    warning: {
        classes: 'bg-amber-100 dark:bg-amber-900/30 text-amber-500 dark:text-amber-400',
        icon: <FilterIcon className="h-1/2 w-1/2" />,
    },
};

const sizeConfig = {
    sm: {
        container: 'py-6 px-4',
        icon: 'h-9 w-9',
        illustration: 'h-24 w-24',
        title: 'text-sm',
        description: 'text-[13px]',
        gap: 'gap-2',
    },
    md: {
        container: 'py-10 px-6',
        icon: 'h-10 w-10',
        illustration: 'h-36 w-36',
        title: 'text-[15px]',
        description: 'text-[13px]',
        gap: 'gap-3',
    },
    lg: {
        container: 'py-14 px-6',
        icon: 'h-12 w-12',
        illustration: 'h-48 w-48',
        title: 'text-base',
        description: 'text-[13px]',
        gap: 'gap-3',
    },
};

const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.4,
            ease: 'easeOut',
            staggerChildren: 0.1,
        },
    },
};

const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.3, ease: 'easeOut' },
    },
};

export const EmptyState = ({
    icon,
    title,
    description,
    action,
    size = 'md',
    className,
    illustration,
    illustrationAlt = 'Empty state illustration',
    cybeMessage,
    tone = 'neutral',
}: EmptyStateProps) => {
    const config = sizeConfig[size];
    const toneStyle = toneConfig[tone];

    const renderVisual = () => {
        if (cybeMessage && SHOWS_CYBE) {
            return (
                <motion.div variants={itemVariants}>
                    <CybeAvatar size="lg" />
                </motion.div>
            );
        }

        if (illustration) {
            return (
                <motion.img
                    variants={itemVariants}
                    src={illustration}
                    alt={illustrationAlt}
                    className={cn('object-contain', config.illustration)}
                />
            );
        }

        return (
            <motion.div
                data-testid="empty-state-visual"
                variants={itemVariants}
                className={cn(
                    'flex items-center justify-center rounded-xl',
                    toneStyle.classes,
                    config.icon
                )}
            >
                {icon || toneStyle.icon}
            </motion.div>
        );
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className={cn(
                'flex flex-col items-center justify-center text-center',
                config.container,
                config.gap,
                className
            )}
        >
            {renderVisual()}

            {/* A card can be 1300px wide; two centred lines spread across it
                read as a layout fault. The copy keeps its own measure. */}
            <motion.div
                data-testid="empty-state-copy"
                variants={itemVariants}
                className={cn('flex flex-col items-center max-w-md', config.gap)}
            >
                <h3
                    className={cn(
                        'font-medium text-zinc-900 dark:text-zinc-100',
                        config.title
                    )}
                >
                    {title}
                </h3>

                {description && (
                    <p
                        className={cn(
                            'max-w-sm text-zinc-500 dark:text-zinc-400',
                            config.description
                        )}
                    >
                        {description}
                    </p>
                )}
            </motion.div>

            {action && <motion.div variants={itemVariants}>{action}</motion.div>}
        </motion.div>
    );
};

export default EmptyState;
