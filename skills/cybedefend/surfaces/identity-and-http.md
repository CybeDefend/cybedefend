# Surface: identity, sessions and the HTTP layer

Read this page when the repository holds its own sign-in, sessions or tokens (JWT, OAuth or OpenID Connect, SAML, magic links, a second factor, passkeys, API keys, client certificates), or its own HTTP layer: a reverse proxy, a gateway, a cache, a custom server or parser, code that builds links from the request. The family "Identity" of [audit.md](../audit.md) asks the basics; this page asks whether the HTTP or identity layer can be fooled about **which person, which request, which token or which level of proof** an action belongs to.

**What counts.**
- A missing header, cookie flag or rate limit alone is hardening, rated under 4. This page looks for more: a request the server accepts that it should refuse, an action credited to the wrong person, a proof skipped, a credential that leaks.
- For each credential, find where its signature or secret is verified, then every binding its role needs: issuer, audience, client, origin, session, account, resource, level of proof, expiry, single use.
- `Host`, `Forwarded`, `X-Forwarded-*`, `Origin`, `Referer`, a return address and a callback `state` are decisions. Follow each to the account or the response it changes.
- A proxy, an identity provider or a browser setting that is not in the repository is unknown, never assumed: when the flaw depends on one, it is a lead that names the one setting to check. A library's default is read in the version the lockfile pins, never remembered.

## Requests and caches

- Two components that read one request differently: two `Content-Length`, `Transfer-Encoding` with a length, a header name normalized on one side only, a line ending converted. Name both components and the bytes each one gives to the next request. Only a proxy, a gateway or a custom parser in the repository makes this reachable.
- A value that changes a cached response and is not in the cache key: a forwarded host or scheme, a header, a cookie, a query parameter normalized differently. The next visitor gets the attacker's version.
- A private page cached as if it were public: a route that also answers to `/account/settings.css`, a path parameter the cache ignores, a response without `private` or `no-store` behind a cache the repository configures.
- A link built from `Host` or a forwarded header: a reset link, an invitation, a callback, a tenant chosen from the host name.

## Browser sessions

- Every change of state that a cookie authenticates (forms, JSON, multipart, a method override, an old route): a token, a same-site rule or a strict `Origin` check that really applies to it? A route that needs a bearer token in a header is not exposed to this.
- A session not renewed at sign-in, at an account switch, after the second factor or an impersonation; still valid after sign-out, a password change, a removal or a disabled account. Check the server sessions, refresh tokens, signed cookies, WebSocket connections and their caches.
- A session cookie with a `Domain` or `Path` wider than it needs, so a sibling application or subdomain can read or replace it.

## Tokens and sign-in through another service

- A JWT, beyond the signature and the expiry: `nbf`, `aud` and `iss` checked; `kid`, `jku` and `x5u` never trusted to pick the key; no path that decodes without verifying. A token signed by a trusted issuer for another service is not valid here.
- OAuth and OpenID Connect, beyond the `state`, the return address and the single-use code: PKCE where it applies; the ID token's issuer, audience, signature and nonce checked; with several providers, the answer tied to the provider that was asked. Compare the first callback, a retry, the mobile path and the account-linking path.
- SAML: the element whose signature is checked is the one whose identity is used; no unsigned or fallback path; the parser safe; validity window, audience, recipient and replay checked.

## Second factor, passkeys, recovery and linking

- Enrolling, replacing or removing a second factor, creating recovery codes or a trusted device: asked with a fresh proof, never with the first factor alone. A removed factor stops working.
- A step-up proof applied to the wrong session, account, tenant or action, or a second path that never asks for it.
- Passkeys: challenge, relying party, origin, credential, user handle and user verification bound at registration and at sign-in.
- Linking a provider, a passkey, an e-mail, a phone or a device to an account: a current session, proof of owning the new identity, and a callback tied to the account that started it. Unlink and relink, and invitation acceptance, too.
- Recovery (reset tokens, support or admin recovery, backup codes, device migration, e-mail change) is often the weakest door: random, single use, bound to one account and one action, short, and every older token and session ended.

## API keys and client certificates

- A key that reaches more tenants, resources, actions or environments than its record grants, or a request field that widens it. A publishable key accepted where a secret key is required. A revoked key still accepted from a cache.
- A key in a client bundle, a URL, a log, an error, a build artifact or a response a lower-trust caller can read. A public identifier named "key" is not a secret.
- A client certificate's identity taken from a header any peer can send, or a subject mapped to an account loosely; an expired or revoked certificate that falls back to no certificate at all.

**Walk each credential's life.** Issued, stored, sent, used, refreshed, revoked: compare the normal path with the error, retry, migration, legacy and account-switch paths. The protection that counts is the weakest door to the same identity or the same action, never the most polished screen.

**Prove it.** Build the token, the request or the callback in the test (an unsigned token, a token for another audience, a callback with another session's `state`, a request with a forged `Host`) and send it through the repository's own test client or middleware stack, so every guard the real route has stays in the path. Assert the guarantee: the request is refused and nothing changed, the reset link points to the configured address, the old session no longer works.

**Kinds:** `request-smuggling`, `cache-poisoning`, `cache-shared-between-users`, `header-trusted`, `state-change-on-get`, `session-fixation`, `session-not-invalidated`, `cookie-without-protection`, `signature-not-verified`, `token-not-bound`, `third-party-sign-in-not-bound`, `second-factor-bypass`, `account-link-without-proof`, `reset-without-proof`, `api-key-scope-not-enforced`, `secret-in-url`.

Adapted in part from the security-audit skill of Cloudflare, under the MIT License: see [NOTICE](../NOTICE).
