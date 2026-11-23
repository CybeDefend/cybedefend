import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import ScrollToTopOnNavigate from './ScrollToTopOnNavigate';

const NavButtons: React.FC = () => {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/page-b')}>go-b</button>
      <button onClick={() => navigate('/page-b?filter=high')}>go-b-filtered</button>
    </>
  );
};

describe('ScrollToTopOnNavigate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('scrolls the window to the top when the pathname changes', () => {
    const scrollSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/page-a']}>
        <ScrollToTopOnNavigate />
        <NavButtons />
      </MemoryRouter>,
    );
    scrollSpy.mockClear();

    fireEvent.click(screen.getByText('go-b'));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT scroll when only the search params change (filters, ?imageId=…)', () => {
    const scrollSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/page-b']}>
        <ScrollToTopOnNavigate />
        <NavButtons />
      </MemoryRouter>,
    );
    scrollSpy.mockClear();

    fireEvent.click(screen.getByText('go-b-filtered'));
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
