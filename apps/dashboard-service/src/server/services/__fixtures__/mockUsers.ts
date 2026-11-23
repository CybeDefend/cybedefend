export interface MockUser {
    id: string;
    email: string;
    name: string;
    organizationName: string;
}

// Keep anonymous: this fixture is imported by
// `components/organismes/layout/Layout.tsx` as a fallback chat-user identity
// and therefore ships in the production bundle. Real employee email/name
// would leak PII to anyone running `npm run build` and inspecting the output.
// All fields must be obviously non-routable demo values (e.g. `demo@…local`,
// "Demo User"). The `id` is stable so existing Redux state-shape assumptions
// (Layout uses `state.user.id || DEMO_USER.id`) remain unchanged.
export const DEMO_USER: MockUser = {
    id: 'demo-user-1',
    email: 'demo@cybedefend.local',
    name: 'Demo User',
    organizationName: 'Demo Organization',
};

export const getDemoUserId = (): string => DEMO_USER.id;
