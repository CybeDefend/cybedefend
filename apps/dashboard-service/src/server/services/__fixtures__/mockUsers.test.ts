import { describe, it, expect } from 'vitest';
import { DEMO_USER, getDemoUserId } from './mockUsers';

/**
 * The DEMO_USER fixture is imported into Layout.tsx as a
 * fallback chat-user identity. It is therefore shipped in the production
 * bundle. The fixture must NOT carry real PII (real employee email/name) — we
 * use anonymous, clearly-fake values so a leaked bundle reveals no personal
 * data.
 */
describe('DEMO_USER fixture (production-bundle safety)', () => {
    it('uses an anonymous demo email — never a real employee address', () => {
        // Must be a .local TLD or otherwise obviously non-routable demo email.
        expect(DEMO_USER.email).toMatch(/^demo@.*\.local$/i);
        // Defensive: explicit allowlist excludes the known-leaked address and
        // any *@cybedefend.com address (real corporate domain).
        expect(DEMO_USER.email).not.toMatch(/cybedefend\.com$/i);
    });

    it('uses an anonymous display name — never a real employee name', () => {
        expect(DEMO_USER.name).toBe('Demo User');
    });

    it('uses an anonymous organization name placeholder', () => {
        // The previous value `Acme Corp` is acceptable as a placeholder but
        // we lock it down so the field cannot drift back to a real org name.
        expect(DEMO_USER.organizationName).not.toMatch(/cybedefend/i);
    });

    it('exposes a stable demo user id via getDemoUserId()', () => {
        expect(getDemoUserId()).toBe(DEMO_USER.id);
        expect(DEMO_USER.id).toBe('demo-user-1');
    });
});
