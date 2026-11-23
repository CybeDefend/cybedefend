/**
 * Whether the container page should (re)select the image named in the URL.
 *
 * The page mirrors the selected image into `?imageId=…` so a reload or a
 * shared link lands on the same image. The deep-link effect re-selects that
 * image whenever nothing is selected — which is exactly the state the Back
 * button creates, one render before the URL update lands. Without the
 * `dismissedImageId` guard, Back re-selected the image from the stale URL
 * and looked dead.
 */
export function shouldResolveImageDeepLink(input: {
  urlImageId: string | null;
  hasSelection: boolean;
  dismissedImageId: string | null;
}): boolean {
  const { urlImageId, hasSelection, dismissedImageId } = input;
  if (!urlImageId || hasSelection) return false;
  return urlImageId !== dismissedImageId;
}
