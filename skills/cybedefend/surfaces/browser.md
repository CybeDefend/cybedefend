# Surface: the browser

Read this page when trust decisions or untrusted rendering happen in the browser: a single-page application, a browser extension, an embedded web view, a service worker, an offline mode, code that writes into the page, listens to messages from other windows or keeps data in browser storage. Some inputs here never reach the server: the URL fragment, `window.name`, a message from another window, what an earlier visit left in storage.

**What counts.**
- A source the attacker controls and a place where it runs or leaks: name both, and show the attacker's data getting from one to the other.
- The harm reaches a victim's session, another origin or shared storage. Injecting into one's own page, or reading one's own data, is not a finding.
- The framework's escaping, the same-origin policy, the Content-Security-Policy and modern browser defaults are real protections: check them before rating anything.
- A deployed header or a browser behavior the repository does not show is unknown: the flaw is then a lead that names it.

## The page itself

- The URL (`location`, the fragment, the query), `document.referrer`, `window.name`, a message, storage: does any of it reach `innerHTML`, `outerHTML`, `document.write`, `eval`, a `javascript:` address, `dangerouslySetInnerHTML`, `v-html`, `[innerHTML]`, `$.html()` or a template compiled at runtime? Interpolation the framework escapes is fine.
- A deep merge or a path assignment with keys from input (`__proto__`, `constructor.prototype`), and then a reachable use of the polluted property that changes a right, a navigation or what is rendered. Pollution with nothing that reads it is not enough.
- Markup an attacker can inject with an `id` or a `name` that shadows a global or a configuration value the code trusts.

## Other windows and the network

- A `message` listener that acts on `event.data` without an exact check of `event.origin` (a prefix, a suffix, `includes` or a loose regular expression is no check), and of `event.source` where several frames share an origin. On the sending side, private data posted to `"*"`.
- A WebSocket opened with the user's cookies and no check of `Origin` or a token of its own, with a handler that reads or changes data.
- CORS that echoes the request's `Origin`, or matches it loosely, with credentials allowed, on a response that holds private data.

## Workers and storage

- A service worker that caches personal responses without the account in its cache key, and serves them after sign-out or an account switch; an offline fallback that returns the previous user's page.
- Tokens, private responses or a decision about rights left in `localStorage`, `sessionStorage`, IndexedDB, the Cache Storage or an extension's storage, read later by another account or kept in use after sign-out. A token in storage is not a finding alone.
- A worker script or one it imports that an attacker can influence, or a worker scope wider than intended.
- Tabs that pass identity or commands to each other (`storage` events, `BroadcastChannel`, a shared worker) without binding them to the current session.

## Frames and navigation

- A page with an action that changes something (pay, delete, grant a right) that another site can frame, with no `frame-ancestors` or `X-Frame-Options`. A read-only page without the header is hardening.
- A navigation or a redirect chosen in the browser from input, with no check of the scheme and the destination.
- An extension: messages from web pages trusted as if they came from the extension itself; permissions wider than its feature; content scripts that put page data into the extension's privileged context.

**Start from the sinks.** List the places that write into the page, navigate, run code, keep data or receive messages, then walk back to every source, from the browser and from the server. Then switch accounts, sign out, update the worker and go offline, and see what each place still holds.

**Prove it.** Use the repository's own component or end-to-end test tools (Testing Library, jsdom, Playwright or Cypress when the project has them) with a local page: render the component with the attacker's input, post a message from another origin, sign out and sign in as another user. Assert the guarantee: no script node, no handler run, no previous user's data. No production origin, no real account.

**Kinds:** `dom-xss`, `stored-xss`, `reflected-xss`, `prototype-pollution`, `message-origin-not-checked`, `websocket-origin-not-checked`, `cross-origin-open-with-credentials`, `cache-shared-between-users`, `session-not-invalidated`, `clickjacking`, `open-redirect`.

Adapted in part from the security-audit skill of Cloudflare, under the MIT License: see [NOTICE](../NOTICE).
