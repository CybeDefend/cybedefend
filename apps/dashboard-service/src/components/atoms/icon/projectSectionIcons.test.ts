import { describe, expect, it } from 'vitest';
import { ShieldAlt, ShieldHalved } from '@/components/atoms/icon/icons';
import { PROJECT_SECTION_ICONS } from './projectSectionIcons';

describe('PROJECT_SECTION_ICONS', () => {
  // Compliance must never share the Platform's logo.
  it('gives Compliance a glyph of its own, never the Platform product glyph', () => {
    // ShieldAlt is Font Awesome's alias of the same half shield: the project list drew Compliance with it.
    expect(PROJECT_SECTION_ICONS.compliance).not.toBe(ShieldHalved);
    expect(PROJECT_SECTION_ICONS.compliance).not.toBe(ShieldAlt);
    const others = Object.entries(PROJECT_SECTION_ICONS).filter(([key]) => key !== 'compliance');
    for (const [key, icon] of others) expect(icon, key).not.toBe(PROJECT_SECTION_ICONS.compliance);
  });

  it('draws Compliance as a line glyph like the tabs beside it, not a solid shape', () => {
    // The solid clipboard read as a second Platform shield at 16 px in the rail.
    expect(PROJECT_SECTION_ICONS.compliance.displayName ?? '').not.toBe('ClipboardCheck');
  });
});
