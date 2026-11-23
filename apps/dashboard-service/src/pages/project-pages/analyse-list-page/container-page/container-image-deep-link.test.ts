import { describe, it, expect } from 'vitest';
import { shouldResolveImageDeepLink } from './container-image-deep-link';

// The container page keeps the selected image in the URL (?imageId=…). The
// deep-link effect re-selects that image whenever nothing is selected — which
// is exactly the state the Back button creates, one render before the URL
// update lands. Back therefore looked dead: the image was re-selected from the
// stale URL. A dismissed id must not be resolved again.

describe('shouldResolveImageDeepLink', () => {
  it('resolves a deep link on arrival (nothing selected, nothing dismissed)', () => {
    expect(
      shouldResolveImageDeepLink({ urlImageId: 'img-1', hasSelection: false, dismissedImageId: null }),
    ).toBe(true);
  });

  it('does nothing when an image is already selected', () => {
    expect(
      shouldResolveImageDeepLink({ urlImageId: 'img-1', hasSelection: true, dismissedImageId: null }),
    ).toBe(false);
  });

  it('does nothing without an image id in the URL', () => {
    expect(
      shouldResolveImageDeepLink({ urlImageId: null, hasSelection: false, dismissedImageId: null }),
    ).toBe(false);
  });

  it('ignores the id the user just dismissed with Back, even while the URL still carries it', () => {
    expect(
      shouldResolveImageDeepLink({ urlImageId: 'img-1', hasSelection: false, dismissedImageId: 'img-1' }),
    ).toBe(false);
  });

  it('still resolves a different id after a dismissal (new deep link, browser navigation)', () => {
    expect(
      shouldResolveImageDeepLink({ urlImageId: 'img-2', hasSelection: false, dismissedImageId: 'img-1' }),
    ).toBe(true);
  });
});
