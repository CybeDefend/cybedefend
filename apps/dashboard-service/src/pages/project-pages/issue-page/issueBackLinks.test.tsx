import { beforeAll } from 'vitest';
import { readySlots } from '@/edition/slots';
beforeAll(() => readySlots(), 30_000);
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import IssueSastIacTemplate from './IssueSastIacTemplate';
import IssueScaTemplate from './IssueScaTemplate';
import IssueContainerTemplate from './IssueContainerTemplate';
import IssuePage from './IssuePage';

/*
  A finding opened from a link (an email, a pull-request comment) has no
  history to go back to: its « Back » falls back to the AppSec list of its
  scan type, under /appsec. Each template is rendered on its error path,
  where « Back » is the only control.
*/

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('@/ee/chat/server/hooks/useAskCybe', () => ({ useAskCybe: () => vi.fn(), default: () => vi.fn() }));
vi.mock('@/ee/ai/server/hooks/useReanalysisPolling', () => ({
  useReanalysisPolling: () => ({ isReanalyzing: false, triggerReanalysis: vi.fn() }),
  default: () => ({ isReanalyzing: false, triggerReanalysis: vi.fn() }),
}));
vi.mock('./IssueDetailView', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <button type="button" onClick={onBack}>
      Back
    </button>
  ),
}));

const LocationProbe: React.FC = () => {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
};

/** Renders `element` on a deep link, clicks its « Back » and returns where it went. */
const backFrom = (element: React.ReactElement, path = '/appsec/project/p1/finding'): string | null => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/appsec/project/:projectId/finding" element={element} />
        <Route path="/appsec/project/:projectId/:type/issue/:issueId" element={element} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button'));
  return screen.getByTestId('location').textContent;
};

type SastIacProps = React.ComponentProps<typeof IssueSastIacTemplate>;
type ScaProps = React.ComponentProps<typeof IssueScaTemplate>;
type ContainerProps = React.ComponentProps<typeof IssueContainerTemplate>;

describe('the way back from an AppSec finding', () => {
  it('goes from a SAST/IaC finding to the AppSec list of its type', () => {
    const props = {
      vulnerability: { id: 'v1', projectId: 'p1', vulnerabilityType: 'iac' },
      projectId: 'p1',
      error: 'not found',
    } as unknown as SastIacProps;
    expect(backFrom(<IssueSastIacTemplate {...props} />)).toBe('/appsec/project/p1/iac');
  });

  it('goes from an SCA finding to the AppSec SCA list', () => {
    const props = {
      vulnerability: { id: 'v1', projectId: 'p1', vulnerabilityType: 'sca' },
      projectId: 'p1',
      error: 'not found',
    } as unknown as ScaProps;
    expect(backFrom(<IssueScaTemplate {...props} />)).toBe('/appsec/project/p1/sca');
  });

  it('goes from a container finding to the AppSec container list', () => {
    const props = {
      vulnerability: { id: 'v1', projectId: 'p1', vulnerabilityType: 'container' },
      projectId: 'p1',
      error: 'not found',
    } as unknown as ContainerProps;
    expect(backFrom(<IssueContainerTemplate {...props} />)).toBe('/appsec/project/p1/container');
  });

  it('goes from the full finding page to the AppSec list of its type', () => {
    expect(backFrom(<IssuePage />, '/appsec/project/p1/secret/issue/v1')).toBe('/appsec/project/p1/secret');
  });

  it('goes to the AppSec home, never the root, when the finding names no project', () => {
    const props = {
      vulnerability: { id: 'v1', vulnerabilityType: 'iac' },
      projectId: '',
      error: 'not found',
    } as unknown as SastIacProps;
    expect(backFrom(<IssueSastIacTemplate {...props} />)).toBe('/appsec');
  });
});
