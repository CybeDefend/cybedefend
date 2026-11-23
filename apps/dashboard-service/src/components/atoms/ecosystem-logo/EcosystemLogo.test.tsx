import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import EcosystemLogo, { normalizeEcosystemKey } from './EcosystemLogo';

describe('normalizeEcosystemKey', () => {
  it('maps canonical OSV ecosystem names (case-insensitive)', () => {
    expect(normalizeEcosystemKey('PyPI')).toBe('pypi');
    expect(normalizeEcosystemKey('npm')).toBe('npm');
    expect(normalizeEcosystemKey('Maven')).toBe('maven');
    expect(normalizeEcosystemKey('Go')).toBe('go');
    expect(normalizeEcosystemKey('NuGet')).toBe('nuget');
    expect(normalizeEcosystemKey('RubyGems')).toBe('rubygems');
    expect(normalizeEcosystemKey('Packagist')).toBe('packagist');
    expect(normalizeEcosystemKey('crates.io')).toBe('crates.io');
    expect(normalizeEcosystemKey('Hex')).toBe('hex');
    expect(normalizeEcosystemKey('Pub')).toBe('pub');
  });

  it('resolves common aliases to their canonical key', () => {
    expect(normalizeEcosystemKey('golang')).toBe('go');
    expect(normalizeEcosystemKey('cargo')).toBe('crates.io');
    expect(normalizeEcosystemKey('crates')).toBe('crates.io');
    expect(normalizeEcosystemKey('composer')).toBe('packagist');
    expect(normalizeEcosystemKey('conda-forge')).toBe('conda');
    expect(normalizeEcosystemKey('  PyPI  ')).toBe('pypi');
  });

  it('returns null for unknown / empty so the caller shows a fallback', () => {
    expect(normalizeEcosystemKey('')).toBeNull();
    expect(normalizeEcosystemKey(undefined)).toBeNull();
    expect(normalizeEcosystemKey(null)).toBeNull();
    expect(normalizeEcosystemKey('ConanCenter')).toBeNull();
    expect(normalizeEcosystemKey('something-weird')).toBeNull();
  });
});

describe('EcosystemLogo', () => {
  it('renders an svg brand logo for a known ecosystem', () => {
    const { container } = render(<EcosystemLogo ecosystem="PyPI" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders a fallback glyph (still an svg) for an unknown ecosystem', () => {
    const { container } = render(<EcosystemLogo ecosystem="ConanCenter" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('forwards the className to the rendered icon', () => {
    const { container } = render(<EcosystemLogo ecosystem="npm" className="w-3 h-3" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class') || '').toContain('w-3');
  });
});
