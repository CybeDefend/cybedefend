import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { cn } from '@/utils/function/utils';
import { PageContainer } from '@/components/molecules/page-container';
import { PageHeader } from '@/components/molecules/page-header';
import Card from '@/components/atoms/card/Card';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import { Ticket, User } from '@/components/atoms/icon/icons';

type ProfileTab = 'general' | 'pat';

interface ProfilePageTemplateProps {
    /** Current user information */
    user: {
        firstName: string;
        lastName: string;
        email: string;
        picture: string;
    };
    /** Currently selected tab */
    selectedTab: ProfileTab;
    /** Page content */
    children: React.ReactNode;
    /** Loading state */
    loading?: boolean;
    /** Optional additional actions for the header */
    headerActions?: React.ReactNode;
}

/**
 * ProfilePageTemplate - Modern presentation component for Profile Pages
 * Consistent styling with the closed areas' page templates and other modern pages
 */
const ProfilePageTemplate: React.FC<ProfilePageTemplateProps> = ({
    user,
    selectedTab,
    children,
    loading = false,
    headerActions,
}) => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const tabs = [
        {
            id: 'general' as ProfileTab,
            label: t('components.profileWrapper.tabs.general'),
            icon: User,
            path: '/profile',
        },
        {
            id: 'pat' as ProfileTab,
            label: t('components.profileWrapper.tabs.pat'),
            icon: Ticket,
            path: '/profile/personal-access-tokens',
        },
    ];

    const handleTabChange = (tab: ProfileTab) => {
        const tabConfig = tabs.find((t) => t.id === tab);
        if (tabConfig) {
            navigate(tabConfig.path);
        }
    };

    // Animation variants
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1,
            },
        },
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: {
            opacity: 1,
            y: 0,
            transition: {
                duration: 0.3,
            },
        },
    };

    return (
        <PageContainer background="default" padding="md">
            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-6"
            >
                {/* Page Header */}
                <motion.div variants={itemVariants}>
                    {loading ? (
                        <div className="flex items-center gap-4">
                            <Skeleton type="avatar" height="48px" width="48px" />
                            <div className="space-y-2">
                                <Skeleton type="text" width="200px" />
                                <Skeleton type="text" width="150px" />
                            </div>
                        </div>
                    ) : (
                        <PageHeader
                            title={`${user.firstName} ${user.lastName}`}
                            description={user.email}
                            icon={
                                user.picture ? (
                                    <img
                                        src={user.picture}
                                        alt={`${user.firstName} ${user.lastName}`}
                                        className="h-12 w-12 rounded-xl object-cover"
                                    />
                                ) : (
                                    <User className="h-5 w-5 text-primary"  />
                                )
                            }
                            iconBgColor={user.picture ? '' : 'bg-primary/10 dark:bg-primary/20 border-primary/20 dark:border-primary/30'}
                            actions={headerActions}
                        />
                    )}
                </motion.div>

                {/* Tab Navigation */}
                <motion.div variants={itemVariants}>
                    <Card variant="default" padding="none" className="overflow-hidden">
                        <div className="flex border-b border-gray-200 dark:border-neutral-800">
                            {tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => handleTabChange(tab.id)}
                                    className={cn(
                                        'flex items-center gap-2 px-6 py-4 text-sm font-medium transition-all duration-200 relative',
                                        selectedTab === tab.id
                                            ? 'text-secondary border-b-2 border-secondary bg-secondary/5 dark:bg-secondary/10'
                                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-neutral-800/50'
                                    )}
                                >
                                    <tab.icon
                                        className={cn(
                                            'h-5 w-5',
                                            selectedTab === tab.id
                                                ? 'text-secondary'
                                                : 'text-gray-400 dark:text-gray-500'
                                        )}
                                     />
                                    <span>{tab.label}</span>
                                </button>
                            ))}
                        </div>
                    </Card>
                </motion.div>

                {/* Main Content */}
                <motion.div variants={itemVariants}>
                    {loading ? (
                        <Card variant="default" padding="lg">
                            <div className="space-y-6">
                                <Skeleton type="text" rows={3} />
                                <Skeleton type="text" rows={2} />
                            </div>
                        </Card>
                    ) : (
                        <div className="space-y-6">{children}</div>
                    )}
                </motion.div>
            </motion.div>
        </PageContainer>
    );
};

/**
 * ProfileSection - A styled section within the profile page
 */
export const ProfileSection: React.FC<{
    title: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
    action?: React.ReactNode;
}> = ({ title, description, children, className, action }) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
    >
        <Card variant="default" padding="lg" className={cn('', className)}>
            <div className="flex items-start justify-between mb-6">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                        {title}
                    </h2>
                    {description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {description}
                        </p>
                    )}
                </div>
                {action && <div className="shrink-0 ml-4">{action}</div>}
            </div>
            {children}
        </Card>
    </motion.div>
);

/**
 * ProfileInfoRow - A row displaying label and value
 */
export const ProfileInfoRow: React.FC<{
    icon?: React.ReactNode;
    label: string;
    value: React.ReactNode;
    className?: string;
}> = ({ icon, label, value, className }) => (
    <div
        className={cn(
            'flex items-center justify-between p-4 bg-gray-50 dark:bg-neutral-800/50 rounded-2xl',
            className
        )}
    >
        <div className="flex items-center gap-3">
            {icon && (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/10 dark:bg-secondary/20">
                    {icon}
                </div>
            )}
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {label}
            </span>
        </div>
        <div className="text-sm font-medium text-gray-900 dark:text-white">
            {value}
        </div>
    </div>
);

/**
 * ProfileActionCard - A card for actionable items in the profile
 */
export const ProfileActionCard: React.FC<{
    icon: React.ReactNode;
    title: string;
    description: string;
    action: React.ReactNode;
    iconBgColor?: string;
    className?: string;
}> = ({
    icon,
    title,
    description,
    action,
    iconBgColor = 'bg-secondary/10 dark:bg-secondary/20',
    className,
}) => (
        <div
            className={cn(
                'flex items-start gap-4 p-4 bg-gray-50 dark:bg-neutral-800/50 rounded-2xl',
                className
            )}
        >
            <div
                className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-xl shrink-0',
                    iconBgColor
                )}
            >
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                    {title}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {description}
                </p>
                <div className="mt-3">{action}</div>
            </div>
        </div>
    );

export default ProfilePageTemplate;
