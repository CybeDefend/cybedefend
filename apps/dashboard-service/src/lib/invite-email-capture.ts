/**
 * Side-effect module, imported FIRST by `src/index.tsx`: the invited address
 * leaves the address bar before any module that records the page URL is
 * evaluated — the edition's trackers load only inside its boot hooks, which
 * run after every static import. `invite-email-capture.test.ts` pins that
 * position.
 */
import { captureInviteEmail } from './invite-email';

captureInviteEmail();
