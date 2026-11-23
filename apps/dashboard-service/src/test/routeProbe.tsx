import React from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Stands in for a page in a route-table test: it prints its name and the
 * location the router settled on (pathname, query string and hash), so a test
 * asserts where a URL ends up without mounting the real page.
 */
const probe = (name: string): React.FC => {
  const Probe: React.FC = () => {
    const { pathname, search, hash } = useLocation();
    return (
      <div data-testid="route-probe" data-page={name}>
        {`${pathname}${search}${hash}`}
      </div>
    );
  };
  Probe.displayName = `Probe(${name})`;
  return Probe;
};

/**
 * A module whose default export, and `exportName` when given, is a probe:
 * `vi.mock(path, async () => (await import('@/test/routeProbe')).probeModule('home'))`.
 */
export const probeModule = (name: string, exportName?: string): Record<string, React.FC> => {
  const component = probe(name);
  return exportName ? { default: component, [exportName]: component } : { default: component };
};
