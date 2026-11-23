import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SeverityChip, { priorityChipLevel, severityChipLevel } from './SeverityChip';

describe('severityChipLevel', () => {
  it('reads a severity whatever its case', () => {
    expect(severityChipLevel('critical')).toBe('critical');
    expect(severityChipLevel('CRITICAL')).toBe('critical');
    expect(severityChipLevel('High')).toBe('high');
    expect(severityChipLevel(' medium ')).toBe('medium');
    expect(severityChipLevel('LOW')).toBe('low');
  });

  it('reads the names scanners and the API use for the same levels', () => {
    expect(severityChipLevel('moderate')).toBe('medium');
    expect(severityChipLevel('informational')).toBe('info');
    expect(severityChipLevel('INFO')).toBe('info');
    expect(severityChipLevel('none')).toBe('none');
  });

  it('reads anything it does not know as none, never as a coloured level', () => {
    expect(severityChipLevel('')).toBe('none');
    expect(severityChipLevel(undefined)).toBe('none');
    expect(severityChipLevel(null)).toBe('none');
    expect(severityChipLevel('constructor')).toBe('none');
    expect(severityChipLevel('unknown')).toBe('none');
  });
});

describe('priorityChipLevel', () => {
  it('gives each priority the hue of the severity it stands for', () => {
    expect(priorityChipLevel('critical_urgent')).toBe('critical');
    expect(priorityChipLevel('CRITICAL_URGENT')).toBe('critical');
    expect(priorityChipLevel('urgent')).toBe('high');
    expect(priorityChipLevel('normal')).toBe('medium');
    expect(priorityChipLevel('low')).toBe('low');
    expect(priorityChipLevel('very_low')).toBe('info');
  });

  it('reads an unknown priority as none', () => {
    expect(priorityChipLevel('')).toBe('none');
    expect(priorityChipLevel(undefined)).toBe('none');
    expect(priorityChipLevel('toString')).toBe('none');
  });
});

describe('SeverityChip', () => {
  it('shows the word it is given and names its level for styling and tests', () => {
    render(<SeverityChip level="critical">Critical</SeverityChip>);
    const chip = screen.getByText('Critical');
    expect(chip).toHaveAttribute('data-severity', 'critical');
  });

  it('forwards what a span accepts (a title, an accessible name)', () => {
    render(
      <SeverityChip level="high" title="High" aria-label="Severity: High">
        H
      </SeverityChip>,
    );
    expect(screen.getByLabelText('Severity: High')).toHaveAttribute('title', 'High');
  });

  it('takes a raw value and reads it as a level', () => {
    render(<SeverityChip level="MEDIUM">Medium</SeverityChip>);
    expect(screen.getByText('Medium')).toHaveAttribute('data-severity', 'medium');
  });
});
