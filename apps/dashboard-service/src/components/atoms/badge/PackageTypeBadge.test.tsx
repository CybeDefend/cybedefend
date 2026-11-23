import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PackageTypeBadge from './PackageTypeBadge';
import type { ScaDetectedLibrary } from '../../../server/interfaces/Vulnerability';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'scaDependencies.dev': 'Development',
        'scaDependencies.transitive': 'Transitive',
        'scaDependencies.direct': 'Direct',
        'scaDependencies.unknown': 'Unknown',
      };
      return map[key] || key;
    },
  }),
}));

const makeLibrary = (overrides: Partial<ScaDetectedLibrary> = {}): ScaDetectedLibrary =>
  ({
    name: 'lodash',
    version: '4.17.11',
    isDev: false,
    isTransitive: false,
    dependencyInfoAvailable: true,
    ...overrides,
  } as ScaDetectedLibrary);

describe('PackageTypeBadge', () => {
  it('renders nothing when dependency info is not available', () => {
    const { container } = render(
      <PackageTypeBadge library={makeLibrary({ dependencyInfoAvailable: false })} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a direct badge for a direct dependency', () => {
    const { container } = render(
      <PackageTypeBadge library={makeLibrary({ isDev: false, isTransitive: false })} />
    );
    expect(container.textContent).toContain('Direct');
  });

  it('renders both dev and transitive badges when applicable', () => {
    const { container } = render(
      <PackageTypeBadge library={makeLibrary({ isDev: true, isTransitive: true })} />
    );
    expect(container.textContent).toContain('Development');
    expect(container.textContent).toContain('Transitive');
  });

  it('wraps multiple badges so they never overflow their container', () => {
    const { container } = render(
      <PackageTypeBadge library={makeLibrary({ isDev: true, isTransitive: true })} />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('flex-wrap');
  });

  it('uses a gap-based layout instead of per-badge margins', () => {
    const { container } = render(
      <PackageTypeBadge library={makeLibrary({ isDev: true, isTransitive: true })} />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toMatch(/gap-/);
    const badges = wrapper.querySelectorAll('span');
    badges.forEach((badge) => {
      expect(badge.className).not.toContain('mr-1');
    });
  });
});
