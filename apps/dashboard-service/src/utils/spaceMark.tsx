import type { ComponentType } from 'react';
import { EyeMark } from '@/components/atoms/icon/eyeMark';
import { ACTIVE_EXTENSIONS } from '@/edition/active';

/**
 * The mark of a product space, read from the registry of the active edition:
 * the closed tree registers its own `Mark` (a register file under src/ee), and
 * anything without one falls back to the house eye.
 */
export function spaceMark(space: string): ComponentType<{ className?: string }> {
  const mark = ACTIVE_EXTENSIONS.products.find((p) => p.id === space)?.Mark;
  return mark ?? (EyeMark as ComponentType<{ className?: string }>);
}
