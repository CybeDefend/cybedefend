import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileHeader from './ProfileHeader';

// A Google account picture, as Logto hands it over. lh3.googleusercontent.com
// answers without any Access-Control-Allow-Origin header.
const GOOGLE_AVATAR = 'https://lh3.googleusercontent.com/a-/example-avatar=s96-c';

const renderHeader = (imageUrl?: string) =>
  render(
    <ProfileHeader
      title="Jane Doe"
      subtitle="jane@example.com"
      imageUrl={imageUrl}
    />,
  );

describe('ProfileHeader — avatar', () => {
  it('loads the picture from its exact URL, with no cache-busting query', () => {
    renderHeader(GOOGLE_AVATAR);
    expect(screen.getByRole('img', { name: 'Jane Doe' })).toHaveAttribute(
      'src',
      GOOGLE_AVATAR,
    );
  });

  it('does not request the picture in CORS mode', () => {
    // With `crossorigin` set, a host that sends no Access-Control-Allow-Origin
    // gets the image blocked by the browser: users saw their initials instead
    // of their Google picture, plus a CORS error per page load.
    renderHeader(GOOGLE_AVATAR);
    expect(screen.getByRole('img', { name: 'Jane Doe' })).not.toHaveAttribute(
      'crossorigin',
    );
  });

  it('falls back to the initials when the picture fails to load', () => {
    renderHeader(GOOGLE_AVATAR);
    fireEvent.error(screen.getByRole('img', { name: 'Jane Doe' }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('gives a new picture a fresh attempt after a failed one', () => {
    const { rerender } = renderHeader('https://avatars.example.com/old.png');
    fireEvent.error(screen.getByRole('img', { name: 'Jane Doe' }));

    rerender(
      <ProfileHeader
        title="Jane Doe"
        subtitle="jane@example.com"
        imageUrl="https://avatars.example.com/new.png"
      />,
    );

    expect(screen.getByRole('img', { name: 'Jane Doe' })).toHaveAttribute(
      'src',
      'https://avatars.example.com/new.png',
    );
  });

  it('shows the initials when there is no picture', () => {
    renderHeader(undefined);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('JD')).toBeInTheDocument();
  });
});
