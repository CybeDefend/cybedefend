import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The Community Edition watches no advisory feed, so it has no zero-day
 * alerts: with no registration of `project.settings.notifications`, the
 * notifications tab shows its other settings alone.
 */
vi.mock('@/edition/active', async (importOriginal) => {
  const { EMPTY_EXTENSIONS } = await import('@/edition/extensions');
  return {
    ...(await importOriginal<typeof import('@/edition/active')>()),
    activeSlots: () => [],
    activeExtensions: () => EMPTY_EXTENSIONS,
    ACTIVE_SLOTS: [],
    ACTIVE_EXTENSIONS: EMPTY_EXTENSIONS,
  };
});
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

import { translate as t } from '@/test/i18n-mock';
import NotificationsSettings from './NotificationsSettings';

const noop = () => undefined;
const props = {
  projectId: 'p1',
  project: { id: 'p1', zeroDayEmailEnabled: true },
  isSlackConnected: false,
  slackChannelName: '',
  onConfigureSlackChannel: noop,
  onSlackChannelChange: noop,
  notifSeverityThreshold: ['critical'],
  onSeverityThresholdChange: noop,
  notifScannerTypes: ['sast'],
  onScannerTypesChange: noop,
  scanCompleteEmailEnabled: false,
  onScanCompleteEmailToggle: noop,
  scanCompleteSlackEnabled: false,
  onScanCompleteSlackToggle: noop,
  weeklyReportEnabled: false,
  onWeeklyReportToggle: noop,
  weeklyReportSlackEnabled: false,
  onWeeklyReportSlackToggle: noop,
  monthlyReportEnabled: false,
  onMonthlyReportToggle: noop,
  monthlyReportSlackEnabled: false,
  onMonthlyReportSlackToggle: noop,
};

describe('NotificationsSettings in the Community Edition', () => {
  it('no zero-day card; the other notification settings are shown', () => {
    render(<NotificationsSettings {...props} />);
    expect(screen.queryByText(t('components.notificationsSettings.zeroDayAlerts'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('components.notificationsSettings.zeroDaySeverity'))).not.toBeInTheDocument();
    expect(screen.getByText(t('components.notificationsSettings.filters'))).toBeInTheDocument();
    expect(screen.getAllByText(t('components.notificationsSettings.scanComplete')).length).toBeGreaterThan(0);
    expect(screen.getByText(t('components.notificationsSettings.reports'))).toBeInTheDocument();
  });
});
