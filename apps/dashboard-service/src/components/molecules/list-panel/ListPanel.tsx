import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import Card from '@/components/atoms/card/Card';
import Badge from '@/components/atoms/badge/Badge';
import Button from '@/components/atoms/button/Button';
import { Skeleton } from '@/components/atoms/skeleton/Skeleton';
import { RefreshCw } from '@/components/atoms/icon/icons';

export type ListPanelHeaderTone = 'default' | 'accent';

export interface ListPanelProps {
  title: React.ReactNode;
  titleAs?: 'h2' | 'h3';
  description?: React.ReactNode;
  /** Rendered as given, before the title. */
  icon?: React.ReactNode;
  /** Shown as a small badge next to the title. */
  count?: number;
  /** Header, right side. */
  actions?: React.ReactNode;
  /** Adds an icon-only refresh button to the header. */
  onRefresh?: () => void;
  /** Spins the refresh icon and disables the button. */
  refreshing?: boolean;
  /** Accessible name of the refresh button. Defaults to a translated "Refresh". */
  refreshLabel?: string;
  /** `accent` tints the header band with the product accent. */
  headerTone?: ListPanelHeaderTone;
  /** Shows skeleton rows instead of the content. */
  loading?: boolean;
  loadingRows?: number;
  /** When true (and not loading), `empty` replaces the children. */
  isEmpty?: boolean;
  empty?: React.ReactNode;
  /** Bottom strip, e.g. a Pagination. */
  footer?: React.ReactNode;
  as?: 'section' | 'div' | 'aside';
  className?: string;
  'data-testid'?: string;
  children?: React.ReactNode;
}

const headerToneClasses: Record<ListPanelHeaderTone, string> = {
  default: '',
  accent: 'bg-secondary/5 dark:bg-secondary/10',
};

/**
 * A titled list surface: header (icon, title, count, actions, refresh), a body
 * that switches between skeleton rows, an empty state and the rows, and an
 * optional footer strip for the pager.
 *
 * The wrapper is labelled by the title heading, so a `section` shows up as a
 * named region.
 */
const ListPanel: React.FC<ListPanelProps> = ({
  title,
  titleAs: Heading = 'h2',
  description,
  icon,
  count,
  actions,
  onRefresh,
  refreshing = false,
  refreshLabel,
  headerTone = 'default',
  loading = false,
  loadingRows = 3,
  isEmpty = false,
  empty,
  footer,
  as: Wrapper = 'section',
  className,
  'data-testid': testId,
  children,
}) => {
  const { t } = useTranslation();
  const titleId = useId();

  let body: React.ReactNode = children;
  if (loading) {
    body = (
      <div className="space-y-2 p-4">
        {Array.from({ length: loadingRows }, (_, i) => (
          <div key={i} data-testid="list-panel-skeleton-row">
            <Skeleton type="block" height="2.5rem" />
          </div>
        ))}
      </div>
    );
  } else if (isEmpty) {
    body = empty;
  }

  return (
    <Wrapper aria-labelledby={titleId} className={className} data-testid={testId}>
      <Card padding="none" className="flex h-full flex-col overflow-hidden">
        <div
          data-testid="list-panel-header"
          className={cn(
            'flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-neutral-800',
            headerToneClasses[headerTone],
          )}
        >
          {icon}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Heading
                id={titleId}
                className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
              >
                {title}
              </Heading>
              {count !== undefined && (
                <Badge size="xs" data-testid="list-panel-count" className="shrink-0">
                  {count}
                </Badge>
              )}
            </div>
            {description && (
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</div>
            )}
          </div>
          {(actions || onRefresh) && (
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              {onRefresh && (
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={refreshLabel ?? t('components.listPanel.refresh')}
                  title={refreshLabel ?? t('components.listPanel.refresh')}
                  onClick={onRefresh}
                  disabled={refreshing}
                  className="focus-visible:ring-2 focus-visible:ring-secondary/50"
                >
                  <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
                </Button>
              )}
            </div>
          )}
        </div>

        <div
          data-testid="list-panel-body"
          aria-busy={loading ? 'true' : undefined}
          className="min-h-0 flex-1"
        >
          {body}
        </div>

        {footer && (
          <div
            data-testid="list-panel-footer"
            className="border-t border-gray-200 px-4 py-3 dark:border-neutral-800"
          >
            {footer}
          </div>
        )}
      </Card>
    </Wrapper>
  );
};

export { ListPanel };
export default ListPanel;
