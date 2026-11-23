import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import IssueRedirect from './IssueRedirect';

const LocationProbe: React.FC = () => {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search + loc.hash}</div>;
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/appsec/project/:projectId/:type/issue/:issueId" element={<IssueRedirect />} />
        {/* The former URL, printed by emails, Slack and pull-request comments. */}
        <Route path="/project/:projectId/:type/issue/:issueId" element={<IssueRedirect />} />
        {/* A route that lacks the finding's ids. */}
        <Route path="/appsec/project/:projectId/broken" element={<IssueRedirect />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

describe('IssueRedirect', () => {
  it('redirects the old issue page URL to the AppSec list page with the drawer open', () => {
    renderAt('/appsec/project/p1/sast/issue/v9');
    expect(screen.getByTestId('loc').textContent).toBe('/appsec/project/p1/sast?issue=v9');
  });

  it('preserves the scan type segment', () => {
    renderAt('/appsec/project/abc/container/issue/zzz');
    expect(screen.getByTestId('loc').textContent).toBe('/appsec/project/abc/container?issue=zzz');
  });

  it('sends a former finding URL straight under the AppSec prefix', () => {
    renderAt('/project/p1/sast/issue/v9');
    expect(screen.getByTestId('loc').textContent).toBe('/appsec/project/p1/sast?issue=v9');
  });

  // Every former finding link (e-mails, Slack, pull-request comments, Jira)
  // goes through this hop: what it carries besides the finding must survive.
  it('keeps every other query parameter and the hash', () => {
    renderAt('/project/p1/sast/issue/v9?branch=main&utm_source=slack#comment-3');
    expect(screen.getByTestId('loc').textContent).toBe(
      '/appsec/project/p1/sast?branch=main&utm_source=slack&issue=v9#comment-3',
    );
  });

  it('takes the finding from the route, never from the query string', () => {
    renderAt('/appsec/project/p1/sast/issue/v9?issue=other&issue=again&branch=main');
    expect(screen.getByTestId('loc').textContent).toBe('/appsec/project/p1/sast?issue=v9&branch=main');
  });

  it('encodes the finding id as one query value', () => {
    renderAt('/appsec/project/p1/sast/issue/v9%26x%3D1%23h?branch=main');
    expect(screen.getByTestId('loc').textContent).toBe('/appsec/project/p1/sast?branch=main&issue=v9%26x%3D1%23h');
  });

  it('keeps an encoded project id in one path segment', () => {
    renderAt('/project/p%2F1/sast/issue/v9');
    expect(screen.getByTestId('loc').textContent).toBe('/appsec/project/p%2F1/sast?issue=v9');
  });

  it('sends a URL without the finding to the AppSec home, never to the root', () => {
    renderAt('/appsec/project/p1/broken');
    expect(screen.getByTestId('loc').textContent).toBe('/appsec');
  });
});
