import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
import CvssScoreCell from './CvssScoreCell';

describe('CvssScoreCell', () => {
  it('renders the score with one decimal', () => {
    render(<CvssScoreCell score={8.74} />);
    expect(screen.getByText('8.7')).toBeInTheDocument();
  });

  it('says « Not available » in words, never a dash nor 0, when score is null', () => {
    render(<CvssScoreCell score={null} />);
    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/—|\b0(\.0)?%?$/);
  });

  it('says « Not available » in words, never a dash nor 0, when score is undefined', () => {
    render(<CvssScoreCell score={undefined} />);
    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/—|\b0(\.0)?%?$/);
  });

  it('says « Not available » in words, never a dash nor 0, when score is zero', () => {
    render(<CvssScoreCell score={0} />);
    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/—|\b0(\.0)?%?$/);
  });

  it('applies critical-risk color for score >= 9.0', () => {
    const { container } = render(<CvssScoreCell score={9.5} />);
    const label = container.querySelector('span');
    expect(label?.getAttribute('style')).toContain('color');
    const svgStroke = container.querySelector('svg circle[stroke-dashoffset]');
    expect(svgStroke).toBeTruthy();
  });

  it('accepts a custom size prop', () => {
    const { container } = render(<CvssScoreCell score={7.0} size={48} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe('48px');
    expect(wrapper.style.height).toBe('48px');
  });
});
