import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { SlotContext, SlotRegistration } from './slots';

const { registrations } = vi.hoisted(() => {
  const mk = (slot: SlotRegistration['slot'], id: string, order: number): SlotRegistration => ({
    slot,
    id,
    order,
    render: (ctx: SlotContext) => <span>{`${id}:${ctx.projectId ?? ''}`}</span>,
  });
  return {
    registrations: [mk('upsell', 'b', 2), mk('upsell', 'a', 2), mk('project.tabs', 'c', 1)],
  };
});

vi.mock('@/edition/active', () => ({
  activeSlots: () => registrations,
}));

import { Slot } from './slots';

describe('Slot', () => {
  it('renders the registrations of its slot, by order then id', () => {
    const { container } = render(<Slot name="upsell" context={{ projectId: 'p1' }} />);
    const texts = Array.from(container.querySelectorAll('span')).map((s) => s.textContent);
    expect(texts).toEqual(['a:p1', 'b:p1']);
  });

  it('renders nothing when no registration targets the slot', () => {
    const { container } = render(<Slot name="finding.panels" />);
    expect(container.innerHTML).toBe('');
  });

  it('passes an empty context when none is given', () => {
    const { container } = render(<Slot name="upsell" />);
    const texts = Array.from(container.querySelectorAll('span')).map((s) => s.textContent);
    expect(texts).toEqual(['a:', 'b:']);
  });
});

describe('readySlots', () => {
  it('readies every active registration that loads on demand, and settles', async () => {
    const ready = vi.fn(() => Promise.resolve());
    registrations.push({ slot: 'upsell', id: 'z', order: 9, render: () => null, ready });
    const { readySlots } = await import('./slots');
    await expect(readySlots()).resolves.toBeUndefined();
    expect(ready).toHaveBeenCalledTimes(1);
    registrations.pop();
  });
});
