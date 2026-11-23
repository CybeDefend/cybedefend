# Audit: the AI scanner

The AI scanner is you, the coding agent, following this method. It is your own review of the repository, the part of the check that goes further than the static scanners of [scan.md](scan.md), and it uses everything they found. It looks for the flaws no rule finds, because they depend on what this code is meant to do. A scanner matches patterns. You can read the intent: which user owns which data, who may do what, which amount may never go below zero. A finding counts when a test in the repository shows it.

This is a code review of the user's repository, done the way a careful senior engineer reviews a change: read, reason, then write the test that fails. Everything stays inside the repository and its test suite.

**Scope.** On the first run in a repository (no `.cybedefend/audit/map.md` yet), `/cybedefend` reviews the whole repository: the first check is a full audit. After that, `/cybedefend` reviews what the branch changed: the code files in `git diff --name-only $(git merge-base HEAD <default branch>)` (leave out documentation, lockfiles, tests, `.cybedefend/` and the skill's own folder), and the entry points in them or that reach them. The rows you do not review keep their verdict in the map, with `(not reviewed this run)` after it. `/cybedefend audit` always reviews the whole repository. On the default branch with nothing changed since the last audit, `/cybedefend` skips the audit and proposes `/cybedefend audit` in its report.

**`/cybedefend deep`** is the whole repository, function by function, for a release, a large change or a repository that matters most: [deep.md](deep.md). A script lists every file, function and method as a tree and cuts it into branches; one agent reviews each branch with this page's method, and every function ends with a verdict in a ledger, so no row is left for a next run. Then the coverage check of step 2 again, each time by an agent that has not seen the map before, until it returns nothing new (three times at most), and each proof and each lead challenged, each corrected proof challenged again. No review sees everything in one pass, so audits add up: the map and the last audit stay in `.cybedefend/audit/`, the findings of earlier runs are checked again by their tests and kept (step 5), and the rows a last audit left `not examined` or `lead` come first. Tell the user it takes longer: tens of minutes on a small service, an hour or more on a large one.

**What done means.** The review is finished when every entry point in scope has a row in the map and every row has a verdict. It is a review of all of them, never a sample: the flaw that costs the most is often in the handler that looked like its neighbours. Tell the user the count before you start ("38 entry points to review"), so the wait has a reason: a few minutes for a small service, ten to thirty for a large one.

**Say where you are.** The user watches this step, on their screen and on the live page the run opened. One command says it, and prints one line to show as it is:

```bash
node <skill>/scripts/cybedefend.mjs progress --of 28                 # after the map: the rows in scope
node <skill>/scripts/cybedefend.mjs progress --reviewed 12           # after each file: the rows reviewed so far
node <skill>/scripts/cybedefend.mjs progress --flaw "A member deletes a task of another member's workspace" --where src/tasks.ts:77   # a proof test just failed for its reason
node <skill>/scripts/cybedefend.mjs progress --lead "Two requests at once may both spend the last credit" --where src/credits.ts:51
```

Say it as you go, never all at the end: the count moves on the user's screen only when `--reviewed` follows each file, and a flaw shows the moment its test fails only when `--flaw` follows that test. A flaw is said in the words of the person it hurts, in one short sentence: who does what, to whom, by their role ("a member", "a viewer"), never by the names of the test's users. It is the sentence the finding keeps as its `title` (step 4): once the audit file is written, the page shows each finding under that title. Never a secret, a token or a password in it. `--reviewed` and `--flaw` go together in one call when a file gave both. A sub-agent that reviews an area calls it the same way.

**Use the scanners' results.** Before you hunt, read what this run's scanners found: the digest that `start.mjs` printed (`node <skill>/scripts/cybedefend.mjs digest` prints it again). It is a few dozen lines, where the tools' own files are thousands: open one of those only for a finding you need in full, and never the Gitleaks one. A pattern the scanners found is often the start of a longer path they cannot follow, through the code's own rules.

**Read the code after the scan, never before.** The scan says which files hold a secret, and those are read with `node <skill>/scripts/cybedefend.mjs show <file>`, which masks it. Settings, constants and environment files are read that way whatever the scan said.

## 1. Map every entry point

1. **List the entry points from the code, yourself.** Search the router and registration calls of the framework: `app.get(`, `router.POST(`, `@app.route`, `@GetMapping`, `path(` in a `urls.py`, `resources` in `routes.rb`, the operations a framework declares in its own file, GraphQL resolvers, RPC methods. Then what has no URL: message consumers, scheduled jobs, webhooks, CLI commands, admin scripts. `.cybedefend/out/noir.json` (OWASP Noir), when the scan wrote it, is a second list to compare with, never the list: it can read an OpenAPI file and miss the routes the code registers (on one test service it saw 6 of 39). The longer list wins. A library with no route has its public functions that take outside input as entry points. A flaw with no route (a signing key committed in a settings file) takes a row of its own: `config: app.env`, read by whoever reads the repository.
2. Read `.cybedefend/audit/map.md` if it exists (the map of the last audit), and bring it up to date.
3. **One row per entry point** in a table of the map, never several entry points in one row:

   | Entry point | Who may call it | Reads / changes | The check that enforces it (file:line) | Verdict |
   |---|---|---|---|---|
   | `DELETE /accounts/:id` | the account's owner | deletes the account | none, `account_controller.go:171` | |

   The first four columns come from reading the route and its handler. In "Reads / changes", name the functions and files the request's input goes through before it is stored or used (`TaskService.remove`, `tasks.repo.ts`): that path is what step 2 reads, and what the sweep by class at the end of step 2 comes back to. The verdict stays empty until step 2 has reviewed the row. It is the last column, and a pipe inside a cell is written `\|`.

   One exception to a row each: command-line tools that their own operator runs, with their own arguments and their own rights, cross no boundary. The tools of one folder share one row, unless one of them runs with more rights than its caller or is called by a service.
4. **Write the code's guarantees** as plain sentences, under "Guarantees" in the map, from the README, the docs, the data model, the existing tests and the code itself. For example: a member sees only their own team's documents; only the owner of a workspace deletes it; a transfer never takes a balance below zero; a reset link works once, for one account, for one hour; an order is paid before it ships. When nothing says it, the code that does it right says it: if the delete checks the owner, the read should too.
5. **Name the surfaces.** Some parts of an application have flaws of their own, with their own questions. From what the map holds, say which of these the repository has, on a line "Surfaces:" under the guarantees, and read the page of each one that applies, only those, before step 2:

   | The repository has | Page |
   |---|---|
   | Code that calls a model: a chat, retrieval over documents, an agent's memory, tools a model calls, an MCP server or client | [surfaces/ai-agents.md](surfaces/ai-agents.md) |
   | Its own sign-in, sessions or tokens (JWT, OAuth, SAML, a second factor, passkeys, API keys), or its own proxy, gateway, cache or HTTP parser | [surfaces/identity-and-http.md](surfaces/identity-and-http.md) |
   | Trust or rendering in the browser: a single-page app, an extension, a web view, a service worker, messages between windows, browser storage | [surfaces/browser.md](surfaces/browser.md) |
   | GraphQL, gRPC, webhooks, a queue or a broker, streaming | [surfaces/messaging-and-rpc.md](surfaces/messaging-and-rpc.md) |
   | Data of several users or tenants that is copied out of its table: a cache, a search index, shared or signed links, exports, backups, imports, soft deletion and restore | [surfaces/data-lifecycle.md](surfaces/data-lifecycle.md) |
   | Its own deployment, cloud permissions, CI workflows, release or update channel | [surfaces/infrastructure.md](surfaces/infrastructure.md) |
   | A desktop or mobile app, deep links, a web view bridge, a local service or helper, native code that parses input | [surfaces/native-and-local.md](surfaces/native-and-local.md) |

   A typical web service has two or three. Each page's questions go to every row they touch, like the families below, and its kinds are in the table of step 4.

**Work file by file.** Open a routes or controller file once, read it whole with its line numbers (`cat -n`, one file per command: a finding needs its exact line, and a long output is cut), and write the rows of that file with their verdicts while it is in front of you; then go to the next file. Reading one handler at a time, or the same file twice, is what makes a review slow and costly.

**A large repository.** Start with what anyone can call without an account, then the files where a mistake costs the most: money, identity and sessions, rights and administration, other tenants' data, files and uploads; then the rest. Generated code, vendored code and the client's display code are not entry points: a page a framework only renders gets no row, whatever a tool lists. A router that generates its routes (one resource, five routes) gets one row per route, and its check is the guard on the line that registers it. A route that serves a whole folder (static files, a file server) is one row. `not examined` is for what a review cannot read (a handler that is generated or in a binary) and for what is beyond this run: review at least 150 rows in one run, in that order. Past that, each row left gets `not examined: beyond this run`, the report says how many, and the next `/cybedefend audit` starts with them. Never a silence, and never `not examined` for a row because it looked dull.

**Handlers a framework generates from a configuration** (its sign-up, sign-in and reset routes, an admin panel) are reviewed through that configuration: what it turns on and off (the password rule, the e-mail verification, the limit on attempts, who may open the panel) is the row's check, and a setting left open is a finding or a lead like any other. `not examined` only when nothing in the repository says how they are set.

## 2. Review every row

Take the rows in order. For each one, read the handler from the input to the storage, ask the questions below, and write its verdict:

- `ok`, with what protects it (the check, its file and line). A row is `ok` only when you have read its handler and can name what protects it.
- `finding: <kind>`, when it breaks a guarantee and a test shows it (step 3).
- `lead: <what>`, when you think it breaks one and could not prove it.
- `not examined: <why>`.

**A large map: split the review.** More than about thirty rows, and your harness has sub-agents: cut the map by area (the rows of one folder or one feature together, since they share their checks), and hand every area out at once, each to its own sub-agent, with this file, [proofs.md](proofs.md), the rows of its area and the roles the application has. Each one returns its rows with their verdicts, its proof tests (written under the names step 3 gives) and its findings in the format of step 4. Tell the user how many you started and what each covers, and say each area's result as it comes back. You keep the map, run every returned test yourself once before you count it, and look yourself at what crosses areas: an object created in one and read in another. Thirty rows or fewer, or no sub-agents: review them yourself, in order.

**A row can break several guarantees.** Ask every question of the list for it, never only as far as its first finding: the transfer that accepts a negative amount may also accept the same account on both sides and check the balance outside its transaction. Each one is a finding. The row stays one row, and its verdict names each kind: `finding: missing-object-authorization, client-controlled-value`. How many is not a judgment call: a handler that loads another user's object and also decides on the caller's word has both findings, each with its test, and so has the next handler like it.

**Each broken row is its own finding, with its own test**, even when it is the tenth of its kind. The developer fixes handlers one by one and the dashboard follows them one by one, so "same family as the one above" is not a verdict. The second proof of a kind costs little: copy the first test, change the route and the input. A flaw in one shared function (a session nobody signs) breaks every row that trusts it: one finding for each of those rows, on the line of its own handler, with its own test.

**When you find one, sweep.** A flaw is rarely alone: the hand that trusted a value from the client in one handler did the same in its neighbours. Name the kind, then check every other row for it before you go on: the same call (lexical), the same shape of code under other names (structural), the same mistake in another feature (logical).

**Read each path to its end.** Follow the input through parsing, identity, rights, normalization, storage, the copies made of it and the last call that uses it. Read the paths that reach the same effect by another way: the legacy one, the bulk one, the retry, the cancellation, the migration, the error branch. Try the values the interface accepts and the developer did not think of: absent, empty, zero, negative, very large, duplicated, in another encoding, stale, revoked, out of order, two at once. Where one component hands a value to the next (a parser to a policy, a gateway to a service), compare what the first guarantees with what the second assumes. A value checked when it is written and trusted when it is read: look for the other writer (an import, an admin script, an older route, a job) that skips the check. A comment that explains why the code is safe is a claim: check it. One flaw does not close a row: ask the questions that are left, and give each flaw its own finding and its own test.

**Compare siblings first.** The fastest lead is two handlers on the same data with different checks: the delete checks the owner, the read does not; the web route checks the role, the API route does not; the list filters by organization, the export does not; the single action checks, the bulk action does not; version 2 of an endpoint checks, version 1 is still served and does not.

**The roles, one by one.** Before the first row, list the roles the application has: no account, an account anyone can create, a member, a member of another tenant, an administrator of one tenant, a member who was removed, a read-only or guest role, a service or an API key. For each row, say what each of them gets, never only the role the route was written for. Most flaws of rights are a role nobody thought of on a route that works.

**Ask only what the row has.** The families below cover what an application can have. A row with no file gets no question about files, an application with no payment none about payments: say in the map which families apply ("Families: rights, identity, flows, money, limits"), next to the surfaces of step 1, and ask every question of those for every row they touch.

**Rights**
- Is the route behind the authentication the others have? A route registered outside the authenticated group, a debug or internal endpoint left in.
- Each object loaded by an id that comes from the request: is it checked against the caller (owner, organization, role) before it is returned or changed? Nested ids too (`/orgs/1/projects/2` where project 2 belongs to another organization), and ids in the body, the query string or a file name. A check that compares loosely (a prefix, a few characters, a case-insensitive match) is no check.
- Each query on a table that several tenants share: filtered by the caller's tenant in every path, including search, export, counts, reports, background jobs and cache keys?
- Two objects tied by ids from the request (a task given to a user, a file attached to a ticket, a card moved to a board, a payment method put on an order): each one checked against the caller's tenant, never only the first.
- Roles checked on the server, before the action, never only in the interface. No route that trusts a role, a user id or an organization id sent by the client.
- A right the caller gives themselves: a role or an owner field in their own profile update, an invitation sent or accepted with a higher role, a member who promotes another, an API key created with more rights than its creator has.
- Rights taken away (a member removed, a role lowered, an account disabled): does a session, a token, an invitation or an API key keep the old rights?
- A second path to the same action, with its own check or none: the API next to the web route, an older version still served, the bulk, import or export form, a GraphQL field next to a REST route, a WebSocket message, a webhook, an admin script.
- Approvals: the person who asked approves, pays out or reviews their own request; one account holds both sides of a rule that needs two people.

**Security code that does nothing.** Read every function whose name promises a check (`is_allowed`, `password_complexity`, `validate_*`, `check_*`, `verify_*`, `sanitize_*`) and every security setting read from a file: a check that returns a constant (`return True`), a TODO, a commented-out line in a policy file (a CSP whose `script-src` is commented, a header set only in debug). The same for a handler that answers yes and does nothing: a sign-out that ends no session, an "approved" that looked at nothing, a signature accepted when it is empty. And for limits that exist only as a name: a constant, a setting or a column for a daily limit, a maximum amount, a frozen flag or a role that no handler reads, or a limit set so high that it limits nothing.

**Checks that fail open.** Read what each check does when something goes wrong, not only when it works: the permission service does not answer, a setting is missing, a feature flag is off, a token does not decode, a signature or a decryption throws. A `catch` that logs and carries on, a default of `true`, an empty list of rules read as "no rule, so allowed": the request goes through on the error path that no test takes.

**Identity**
- Sign-up, sign-in, password reset, email change, invitations, magic links, API keys: single use where they should be, an expiry, bound to one account, compared in constant time, drawn from a secure random source, never logged, never in a URL that ends in a log. A reset that asks for no proof of identity.
- Passwords: a minimum length and a check against common or leaked passwords, at sign-up and at every change (CWE-521); the current password asked before a change; one account per username or e-mail; stored with a slow, salted hash made for passwords.
- Sessions renewed at sign-in, ended at sign-out and at a password change; the session cookie sent with `Secure`, `HttpOnly` and `SameSite`.
- A second factor: the step after it refused without it, a code refused the second time, attempts limited, a recovery path (a backup code, a reset, a support flow) as strong as the factor.
- Tokens: the signature checked with a fixed algorithm and a key that is no default written in the code, the expiry and the audience checked, an unsigned token refused.
- Sign-in through another service (OAuth, OpenID Connect, SAML): the `state` checked and tied to the session that started the flow, the return address compared exactly, the code used once, an existing account linked only after its owner proves it.
- An e-mail address nobody verified that opens something: an organization joined by its domain, an invitation accepted from another address, a change of address applied before the new one is confirmed, an address a provider returns without saying it is verified.
- Sign-in and reset answers that tell which accounts exist, and no limit on attempts.

**Input trusted too early**
- Objects filled straight from the request: can the caller set `role`, `isAdmin`, `ownerId`, `orgId`, `price`, `balance`, `status`, `verified`? On their own object too: it is another flaw than a missing sign-in or a missing owner check on the same route, with its own finding and its own test. A role or a flag that no check reads yet is still one: the day a check reads it, the caller already holds it.
- Values the server should compute but takes from the client: totals, prices, rates, fees, discounts, quantities, dates, an "approved" or "skip" flag, the caller's own id. A value only the business sets (an interest rate, a credit limit, an account tier, a role) needs no written rule to be a finding: a customer who chooses their own is one, and the test that shows the server took it is its proof.
- A parameter the interface never shows and the handler still reads: a `debug`, `admin`, `test` or `price` field, a field kept from an older version of the form.
- Headers taken at their word: `X-Forwarded-For` for a rate limit or an allow list, `Host` in a reset link.
- Data that comes from another service: a partner's API answer or a notification it sends is input like any other. An id from it used to load an object with no check on the tenant, its HTML rendered, an address in it fetched by the server, a status ("paid", "verified") taken with no signature.

**Flows in several steps.** Write each flow of the application as its steps, under "Flows" in the map (one line per flow, a list: the tables of the map hold entry points only): sign-up, verification, first use; invitation, acceptance; cart, price, payment, delivery; reset asked, link opened, password changed; trial, plan, cancellation; export asked, built, downloaded. Then, for each step:
- What does it take from the step before, and through whom? An id, a total, a "verified" or a "paid" that comes back through the client is the client's word.
- Can it be called without the step before, twice, out of order, or with another user's object? Shipped before paid, one's own request approved, cancelled after delivery, a one-time flow used again, a frozen or closed account that still acts.
- Does it run what the earlier step validated, or values sent again?
- What stays held when the flow is dropped halfway: a stock, a seat, a username, a discount?

**Money and plans**
- Amounts and counts: negative, zero, very large, not whole, rounded; a refund or a transfer above what there is; the same account on both sides of a transfer; a coupon used twice.
- Computations: a rounding that always favours the caller, a percentage above 100, discounts that add up below zero, two currencies mixed, a total computed in one place and charged from another.
- Who says an order is paid: the payment provider, in a signed notification checked on the body as it was sent and refused the second time, or the browser coming back from the payment page? The amount and the currency paid are compared with the order.
- A plan's limits (seats, projects, calls, storage) checked by the server on each action, never only by the interface; what a downgrade, a cancelled subscription or an ended trial still allows; a trial started again with another address.

**Limits and time**
- What may happen once, or a few times: a vote, a referral bonus, a welcome credit, a one-time code, a free trial. Is the count kept on the server, per account and per what the rule protects?
- What costs money or work each time it runs (a text message, an e-mail, a call to a model, an export, a report), with no cap per caller.
- A size the caller chooses: a page of results with no maximum, a query whose depth or batch has no bound (GraphQL), an upload with no size limit, an archive far larger once unpacked than the size that was checked, a job a member can start any number of times, costly work done before the caller is identified. It counts when someone else pays: another user, the shared service, the operator's bill.
- The same request sent twice (no idempotency), a date in the past or the future taken from the client.
- Two requests at the same time on a balance, a quota, a stock or a unique name: a check, then the action, without a transaction or a lock between them.
- What has an end: an invitation, a trial, a subscription, a coupon, a link, an API key. Is the end checked on the server's clock at the moment of use?
- Data that is right in form and impossible in the business: an end before its start, a quantity of something sold one at a time, an id of the right shape that names another kind of object.

**Files that come in**
- The type decided on what the client says (the extension, the content type) and never on the content; the size; a name or a path the caller chooses; an archive whose entries choose where they land.
- Where a stored file is served from, and as what: sent back as a page from the application's own origin, it runs in the session of whoever opens it.
- Who may download it: an address that is its only protection, a signed address that never ends, another tenant's file reachable by its id.

**Data that leaves**
- Responses and serializers that return more than the caller may see: password hashes, tokens, card numbers, other users' emails, another tenant's rows.
- Errors, logs and analytics events that carry secrets or personal data; an error that returns a stack trace, a query or a path to the caller.
- A response with private data that a cache serves to someone else: the framework's, a CDN's, a key without the caller in it.
- A sensitive action that leaves no trace of who did it (a role changed, an export, a deletion, a payout): hardening, rated under 4, unless the code's own rules ask for the trace.
- Data that should be gone: a row deleted, archived or made private that search, an export, a count, a cache or a background job still serves, or that a restore brings back.

**Features used against their purpose.** A feature that works as designed can still hand a caller more than their rights ([surfaces/data-lifecycle.md](surfaces/data-lifecycle.md) asks the rest, when data has copies):
- An export, a report or a backup that holds other users' rows, drafts, deleted rows or old versions. An import or a restore that writes a role, an owner or a status the normal form refuses, or brings an object back with its old rights.
- Search, filters and sorting on a field the caller may not read: what comes back, or in which order, tells its value. A count that includes the rows the list hides. "Not found" for one id and "forbidden" for another, which lets anyone list other users' objects.
- A preview, a draft or a share link: a token made for one object that opens others, or still works after the object is made private or deleted.
- An address the user sets and the server calls later (a webhook, a callback, an avatar or import URL): checked against internal addresses at the moment of the call, and again after a redirect.

**Dangerous calls the scanners lost track of.** Input that reaches them through a parameter the rule did not follow, a database, a queue, a configuration value, a template or a second function, as a value or as a name (a field name, a key, a header): SQL built from strings (a sort or filter column taken from the query string), a database query that takes its operators from a JSON body, a shell, a file path, a URL the server fetches, a redirect, the deserialization of untrusted data, template rendering, `eval`, an XML parser that resolves external entities, a regular expression built from input or one that backtracks on it, an object merged with keys from the request, a cell of a spreadsheet export that starts a formula, a response or an e-mail header. A value stored safely can become dangerous where it is read back: a name that becomes a file path, a saved address that a job fetches, a stored text rendered as HTML in another screen.

**Configuration in code.** Security headers the app sends or should send (a Content-Security-Policy with a `script-src`, no `unsafe-inline` for scripts, `frame-ancestors`; HSTS behind TLS), debug mode in production settings, a signing key or a password committed in a settings or environment file that the secret scan did not flag (read with `show`, it tells you the name and masks the value) or one that falls back to a value written in the code when the setting is absent, CORS open to any origin with credentials, cookies without `Secure`, `HttpOnly` or `SameSite`, CSRF protection turned off, a WebSocket that checks neither the origin nor the session, uploads without a type or size limit, permissive defaults that every deployment inherits.

**Code that calls a model**, when there is some: its questions are in [surfaces/ai-agents.md](surfaces/ai-agents.md). In short: text from outside, sent now or stored earlier (a document, a ticket, a saved memory), that reaches a prompt which decides an action; model output used as a query, a command or a page; a tool or a tool server that acts with the server's rights, or takes from the model an id the code never checks against the caller.

**Then sweep by class, from the dangerous call back to the map.** When every row has its verdict, take the classes one at a time, search the whole code for their calls, and follow each call back to an entry point of the map: command and code execution (`exec`, `spawn`, `system`, `eval`, a template rendered from input, the deserialization of untrusted data), SQL and NoSQL queries built from strings or taking operators from the body, file paths and writes (a path, an archive entry, an upload name), addresses the server fetches, redirects, XML parsers, and objects loaded by an id from the request with no owner or tenant in the query. A call that an entry point reaches with a value the caller chooses, and that its row did not name, is a finding or a lead on that row: correct its verdict. This is what a reading row by row misses when the input travels through a helper, a queue, a job or a second file.

**Then two short passes, a few minutes each: searches, not a second review.**
- **The strange code.** The code that looks least like the rest: a feature half finished, experimental or bolted on, a variable named `temp`, `hack`, `legacy` or `old`, a fallback, a compatibility layer. What the API accepts that the interface never sends: a parameter, a header, a route no screen calls. Two features that were not designed together (an import and a webhook, an impersonation and an API key). The edge cases the tests check, and the ones they do not. Read each until you can say whether it is safe.
- **The obvious.** Checked literally, one by one: `TODO`, `FIXME`, `HACK` or `XXX` that mention a check, a right or a validation; debug or development mode switched on by a variable, a query parameter or a header; seed, test or example accounts that work outside tests; `/debug`, `/admin`, `/test`, `/metrics`, `/env`, `/config`, `/actuator` or a health route that tells too much, served without a check; `eval`, `exec`, `Function(`, `child_process`, `vm.` or a dynamic `import()` fed with a value from outside; parameters named `redirect`, `return`, `next`, `url`, `goto` or `continue` that choose a redirect; stack traces or queries in error responses. For each hit, follow the whole path before you call it a finding: a flag is not a finding.

**Then put what you found side by side.** What one finding or lead gives (an id read, a row written, a token kept) may be what another one lacked. A lead that becomes provable this way gets its test; a finding that reaches further is rated for what one test shows from the first request to the last effect.

**When a review is cut short** (a limit of time or of context, a sub-agent that did not come back), the rows it did not reach say so: `not examined: <why>`, and the report counts them. A map that looks complete because rows were left out is worse than a short one that says where it stopped.

**What is not a finding.** A finding is something a person can do today that a guarantee forbids: you can say who does what, to whom, and what it costs. Leave out what the scanners already report on this branch, style, best practices with no path from an input, and code you have not read. A false alarm costs the user as much as a miss: when you doubt, it is a lead.

**Find the layer that already stops it.** Before a row gets a finding, name the strongest protection on the real path: a middleware, a guard on the router, a gateway, a validation pipe, a framework default (an ORM scope, a serializer that keeps only declared fields), a database constraint, a row policy. A finding's message names it and says why it does not stop this input. If one of them stops the attack, the missing second check is hardening: rated under 4 if you keep it, never as the attack it does not allow. If the decisive protection is outside the repository (a proxy, an identity provider, a cloud setting), the row is a lead that names the one setting to check, never a finding nor an `ok`. A user doing to their own account what they may already do crosses no boundary; a user who gives that account a role, a plan, a balance, a limit or a right that nobody granted them does, and it is a finding.

**A handler that is not finished.** A handler that decides on the client's word and stores nothing yet (it answers "approved" or "processed") still breaks its guarantee in its answer: it is a finding, rated for what that answer grants today, and its message says the handler stores nothing yet. The same for a handler that only computes: a rate, a profit, a payout or a "valid" worked out from numbers the caller chose is a decision made on the client's word. A row is `ok` for storing nothing only when its answer decides nothing.

### Have the map checked by an agent that did not write it

In `/cybedefend audit` and `/cybedefend deep`. `/cybedefend` skips this check and the challenge of step 3: it is the quick command, and its report says what the two others add. When every row has its verdict, a second agent looks for what the review missed. The one who checks is never the one who wrote. When your harness can run a sub-agent in the background, save the map (`.cybedefend/audit/map.md`), then start it with the brief below, at the same time as the challenge of step 3, and tell the user in one line: "two agents that did not write this review now check it: one looks for what it missed, one tries to break each proof". While they work, collect the triage ([SKILL.md](SKILL.md), step 3) and draft `findings.json`.

> **The brief.** You did not write this review of the repository. Find what it missed: coverage, not new findings. Read the map (`.cybedefend/audit/map.md`), then the code. Run nothing and change no file. Return a short list, one item per gap, each with where it is (`file:line`), why it is a gap and the row it belongs to (or "new row"):
> 1. Entry points in the code with no row: router and registration calls, resolvers, RPC methods, message consumers, scheduled jobs, webhooks, command-line tools, routes a framework generates, a second version or an alias of a route, a bulk, import or background path to an action that has a row.
> 2. Rows marked `ok` whose protection is not named at `file:line`, or whose named check does not cover that row's object, tenant or role. Rows left `lead` or `not examined` that the code in the repository can settle.
> 3. Two handlers on the same data with different checks, where the map does not compare them.
> 4. Families and surfaces the repository has that were not asked of the rows they touch (compare the lines "Families:" and "Surfaces:" of the map with the code), and flows whose steps were not tried out of order or twice.
> 5. Calls of a dangerous kind (execution, queries built from strings, paths, fetched addresses, redirects, deserialization) that an entry point reaches and that no row names.
> Return the list and nothing else. An empty list is a valid answer.

Then take each item yourself: add the row or review the row again, with the same method, and prove what breaks. `progress` counts it like the rest: `--of` with the new total, then `--reviewed` and `--flaw` as you go. Say the result in one line ("coverage check: 3 entry points added, 1 flaw more"). In `/cybedefend audit`, one check; in `/cybedefend deep`, again until it returns nothing new, three times at most. With no sub-agent, do this pass yourself after the review, with the brief's questions, as if the map were someone else's.

## 3. Prove each one with a test

A lead becomes a finding when a test shows it. For each lead:

1. Write a test of the guarantee in the repository's own test framework, with its own fixtures, test client or functions, in the test process. Name it after the guarantee: `test_security_<guarantee>`, for example `test_security_member_cannot_export_other_org_project`. The test asserts what the code should do, so it fails today.
2. Run it alone, without its expected-failure mark. It must fail for the reason you claim: read the failure message, it is your assertion. A failure for another reason (an import, a fixture, a typo) proves nothing: fix the test, not the claim. After two tries without a clean failure, the lead stays a lead.
3. Mark it as an expected failure, so the suite stays green until the fix, or keep it out of the default run when the framework has no such mark. [proofs.md](proofs.md) has the recipe for each stack (Python, JavaScript and TypeScript, Go, Ruby): the mark, how to run a test without it, a repository with no test suite, code that imports generated modules.
4. Run the whole suite: it passes as before. If it was already failing before you added anything, note which tests, leave them as they are and say so in the report.

**What makes a proof valid.**
- It calls the repository's real handler or function, never a copy of its logic.
- It replaces only what is outside the code under test: the database, the network, the clock, a third-party SDK. A replacement behaves like the real thing where the proof depends on it: a fake `update` that ignores its `where` proves nothing.
- It fails on your assertion, and you have read that message.
- One test per finding. A table of cases that gives each finding its own named test is fine when a sweep finds twenty of a kind.
- It asserts the guarantee, so that any correct fix turns it green: "the other user's post is unchanged and the request is refused" holds for every fix; "the answer is 403" or "the stored password equals the one typed" breaks with the right one.
- A proof that passes when you expected it to fail is a warning: find out why before you drop the lead (a test client can drop the input you forged).
- It is made as the caller the flaw needs, on the object the flaw is about. A field no caller should set (a role, a balance, a plan, a price, a status) is proven signed in, as the owner, on their own object: a call refused for a missing sign-in, or on another user's object, says nothing about it. A test that the fix of another flaw would turn green is not this flaw's proof, and neither is a test that asserts something else than the message says (a message about an overdraft with no limit needs a test that overdraws).
- It goes through the protections the real path has. A test that calls a service function while the route in front of it has a guard proves the function, not the route: call the route through the test client with its middleware, or show in the message that nothing on the route stops it.

A test calls the code with test data, in the test process. It never sends a request to a deployed system or to a third party, never uses real credentials or real personal data, never writes outside the repository. It proves that the code breaks its own guarantee, and it is the test the fix needs anyway.

### Have each proof challenged

In `/cybedefend audit` and `/cybedefend deep`, a proof you wrote is checked by an agent that did not write it, and that tries to break it. In `/cybedefend`, leave `challenge` out and go to step 4. With a sub-agent in the background, start it when the review ends, with every proven finding (its message, `file:line`, the test) and every lead, at the same time as the coverage check of step 2, with this brief. More than eight findings: split them between two or three challengers, each with its share.

> **The brief.** You did not write these proofs. Try to break each one. Change no file, and run only the tests named. For each finding:
> 1. Read the cited lines again from the entry point, never from the finding's own account. Run its test alone, without its expected-failure mark (the skill's `proofs.md` gives the command for each stack, with no file to change). Does it fail, and on its own assertion, for the reason the finding gives?
> 2. Does it take the real path: the router, the middleware, the guards, the validation, the serializer? Name the strongest protection on that path and say whether the test goes through it. A test that calls a function directly while a guard on the route would refuse the request proves nothing about the route. When what would stop it is a fact outside the repository (a proxy that strips a header, a cloud policy), say which: the finding is then a lead.
> 3. Do the parts it replaces (the database, the clock, the network, a third-party SDK, a model) behave like the real ones where the proof depends on them? A fake that ignores a filter proves nothing.
> 4. Is the attacker the role the finding says, and not an administrator or the owner by accident (the owner is the right caller when the flaw is a field they set on their own object that nobody should, or a value nobody should receive, such as a password hash returned to its own user)? Is the data really another user's or another tenant's?
> 5. Does the message claim more than the test shows? Does the score follow the table of step 4 for who can do it and what they get? Does the fix enforce the guarantee where the decision is made?
> For each lead, read the code it names: does a check on the real path already stop it, or can a test in the repository settle it after all?
> Answer one line per finding: `holds`, or `broken:` and the reason in one sentence, with what would correct it. One line per lead: `stands`, `refuted:` and the check that stops it (`file:line`), or `provable:` and the test that would show it.

Each proof that holds gets `"challenge": "holds"` in `findings.json` (step 4). A broken one: correct the test, which must then fail for the reason it claims through the real path, and have it challenged again; or the finding goes back to a lead. A lead it refutes is dropped, and its row is `ok` with the check it named, once you have read that check; a lead it calls provable gets its test. Two findings are merged only when one test shows both flaws: otherwise both stay, each with its test, and no proof test is left that no finding points to. A flaw the coverage check brings in is challenged the same way. Say it to the user in one line, with the numbers (`node <skill>/scripts/cybedefend.mjs progress --say "second agent: 6 of 6 proofs hold"`, or "5 of 6 hold, 1 corrected"). With no sub-agent, read each proof yourself with the brief's questions before step 4, and leave `challenge` out: it says that another agent checked it.

**Neither check holds the run.** If one has not answered two minutes after everything else is ready, go on without it: say so in one line, leave `challenge` out of the proofs it did not judge, and name in your report what was not checked.

## 4. Write the findings

Write the findings as a short list in `.cybedefend/out/findings.json`. The script writes the file the dashboard reads from it, the same way in every run:

```json
{ "findings": [
  { "kind": "missing-object-authorization", "score": 8.1,
    "where": "src/routes/projects.ts:142", "entryPoint": "GET /api/projects/:id/export",
    "title": "A member of one organization can export another organization's project",
    "message": "GET /api/projects/:id/export returns the export of any project: a member of one organization downloads another organization's data. DELETE /api/projects/:id checks the organization, the export does not.",
    "attack": ["Sign in as any member of organization A.",
               "Call GET /api/projects/<the id of a project of organization B>/export.",
               "The answer is 200, with the whole export of that project."],
    "impact": "Any account downloads every customer's project data, and sign-up is open.",
    "guarantee": "A member reads only their own organization's projects",
    "proofTest": "test/projects.security.test.ts > member cannot export another organization's project",
    "fix": "Load the project with the caller's organization in the query, as the delete handler does, and answer 404 when it is not theirs.",
    "prevent": "Load every project through the organization-scoped query the delete handler uses, never by its id alone.",
    "challenge": "holds" },
  { "kind": "race-condition", "lead": true,
    "where": "src/billing/credits.ts:51",
    "title": "Two requests at once may both spend the last credit",
    "message": "The check and the decrement are not one statement, so two requests at once may both pass the check. Not proven: the test suite's database runs one statement at a time. To settle it: two concurrent spends against PostgreSQL leave a balance below zero." }
] }
```

```bash
node <skill>/scripts/cybedefend.mjs write-audit
```

**What a person reads.** The dashboard gives each finding a page of its own: its title, why it is a vulnerability, how to prevent it. The script builds that page from the fields below, and the finding's history from the same words. Write them for someone who has never opened this code, a developer of the team or the person they report to: plain words, whole sentences, the names a developer will search for (the route, the handler), never a rule id or an abbreviation of your own. Before you write a finding, know its answers: who can reach it and with which account, what data or money is behind it, how many users or tenants it touches. Read the callers and the data model for that. These words are what the team keeps of the audit: a finding nobody understands is not fixed.

- `title` is this finding's own title, 110 characters at most: who can do what, to whom or to what. "A member of one organization can export another organization's project", "An order is marked paid before the payment provider confirms it". Never the sentence of its kind ("An object is read without checking that the caller may use it"), never a file, a line or a rule.
- `message` is two or three sentences: what the code does, and where that differs from what it should do or from what a sibling handler does.
- `attack` is how it is done, as a list of steps, the ones the proof test takes: who signs in, which request with which values, what comes back. A reader follows it without the code open.
- `impact` is what the caller gets and who pays for it, in one sentence, with its scale: every customer, one account, the caller's own data.
- `guarantee` is the rule that breaks, as the product would state it: "A member reads only their own organization's projects".
- `prevent`, when there is one, is what keeps this class of flaw away from this codebase, in one sentence: the shared helper to go through, the one place where the check belongs.
- `where` is `file:line`: the file relative to the repository root, the line where the check is missing or the flaw is.
- `fix` is the smallest change, at the last place the code decides (the handler, or the shared check every handler calls), that makes the proof test pass: the way the code already does it right elsewhere, when it does. Never a rewrite, never "add validation".
- `kind` names the class of flaw. Use one of these when it fits: the kind gives the finding its CWE, its OWASP category and the last line of its description, the same in every project. A kind of your own, when none fits, comes with its `cwe` (a number).

  | Family | Kinds |
  |---|---|
  | Rights | `missing-authentication`, `missing-object-authorization`, `missing-role-check`, `missing-tenant-filter`, `cross-tenant-reference`, `privilege-escalation`, `rights-kept-after-removal`, `unprotected-alternate-path`, `self-approval` |
  | Input trusted too early | `mass-assignment`, `client-controlled-value`, `decision-on-client-word`, `hidden-parameter-trusted`, `header-trusted`, `third-party-data-trusted`, `check-that-does-nothing`, `check-fails-open` |
  | Business logic, flows, money, limits | `business-logic-bypass`, `unvalidated-amount`, `incorrect-calculation`, `inconsistent-data-accepted`, `state-flow-bypass`, `expiry-not-checked`, `missing-idempotency`, `race-condition`, `usage-limit-not-enforced`, `plan-limit-not-enforced`, `payment-not-verified`, `unbounded-resource-use` |
  | Identity and sessions | `signature-not-verified`, `forgeable-session`, `predictable-token`, `session-not-invalidated`, `session-fixation`, `second-factor-bypass`, `third-party-sign-in-not-bound`, `unverified-email-trusted`, `reset-without-proof`, `weak-password-policy`, `no-attempt-limit`, `account-enumeration`, `timing-leak` |
  | Data that leaves | `sensitive-data-exposure`, `cache-shared-between-users`, `secret-in-logs`, `secret-in-url`, `verbose-error`, `password-stored-in-clear`, `weak-password-hash`, `weak-cryptography`, `cleartext-transport`, `committed-secret` |
  | Dangerous calls | `sql-injection`, `nosql-injection`, `command-injection`, `code-injection`, `template-injection`, `path-traversal`, `unrestricted-upload`, `ssrf`, `stored-xss`, `reflected-xss`, `header-injection`, `formula-injection`, `open-redirect`, `unsafe-deserialization`, `xml-external-entity`, `prototype-pollution`, `regex-denial-of-service` |
  | Configuration in code | `state-change-on-get`, `cross-origin-open-with-credentials`, `cookie-without-protection`, `websocket-origin-not-checked`, `debug-endpoint-exposed`, `insecure-default`, `missing-security-header`, `no-audit-trail`, `unhandled-input` |
  | Code that calls a model, AI agents ([surfaces/ai-agents.md](surfaces/ai-agents.md)) | `prompt-injection`, `model-output-trusted`, `tool-with-excess-rights`, `confused-deputy`, `action-not-bound-to-approval`, `memory-poisoning`, `context-shared-between-users`, `tool-peer-trusted` |
  | Identity and HTTP ([surfaces/identity-and-http.md](surfaces/identity-and-http.md)) | `request-smuggling`, `cache-poisoning`, `token-not-bound`, `account-link-without-proof`, `api-key-scope-not-enforced` |
  | Browser ([surfaces/browser.md](surfaces/browser.md)) | `dom-xss`, `message-origin-not-checked`, `clickjacking` |
  | Messages ([surfaces/messaging-and-rpc.md](surfaces/messaging-and-rpc.md)) | `message-sender-not-verified`, `message-replay-accepted` |
  | Data and its copies ([surfaces/data-lifecycle.md](surfaces/data-lifecycle.md)) | `shared-key-between-tenants`, `export-beyond-rights`, `restore-without-current-rights`, `deleted-data-still-reachable`, `signed-link-overreach` |
  | Infrastructure ([surfaces/infrastructure.md](surfaces/infrastructure.md)) | `untrusted-code-in-privileged-workflow`, `service-identity-with-excess-rights`, `code-fetched-without-integrity-check` |
  | Native and local ([surfaces/native-and-local.md](surfaces/native-and-local.md)) | `local-caller-not-verified`, `deep-link-trusted`, `native-bridge-exposed`, `memory-corruption`, `integer-overflow` |

  The script gives each rule its CWE and, where OWASP files that CWE or that kind, its category in the OWASP Top 10 and in the OWASP API Security Top 10. The dashboard shows the CWE on the finding, and its OWASP report files the finding under that category.
- `score` is a number, read from this table, so that two runs give the same flaw the same score. An account anyone can create counts as no rights: with open sign-up, a flaw that needs a signed-in user is open to everyone.

  | Who can do it | What they get | Score |
  |---|---|---|
  | Anyone (no account, or an account anyone can create) | administrator rights, an account taken over, another user's or tenant's data read | 9.0 to 9.8 |
  | Anyone | another user's objects changed or deleted, a paid feature or money without paying | 8.0 to 8.9 |
  | A user whose account someone had to give them | any of the above | 7.0 to 7.9 |
  | A caller who already holds the right, or a flaw that needs luck (a race, a victim's click, a value to guess) | limited data, one feature made unavailable | 4.0 to 6.9 |
  | Anyone | nothing an attacker gains: hardening | under 4.0 |

  The score follows what the test shows, never more: a crash is not code execution, a user's own data is not another's. If you cannot say what it costs and to whom, the score is lower than it feels. Between two bands: a control defeated with something real behind it (another user's data read or changed, a payment skipped, a role gained) takes the higher; a control only weakened (a limit made easier to reach, a step made easier to guess) takes the lower.

- `challenge` is `"holds"` when the agent that challenged the proof (step 3) could not break it. Left out when no other agent checked it; never anything else: a broken proof is corrected and challenged again, or goes back to a lead.
- A lead you could not prove is `"lead": true`, with its `title` and its `message` and no `proofTest`, no `fix` and no `score`: it goes as a note in a low rule of its own, because the team's policies judge severity and a deploy must never be blocked by something nobody proved. Its message ends with the one fact that blocked the proof and the check that would settle it ("Not proven: ... To settle it: ..."), so the next person starts there. Five at most in the list, the strongest: the others stay in the map, as `lead` rows, and the report says how many. A lead is a precise question, never a guess parked: an idea with no path from an input is left out.
- The dashboard then rates each finding on its own scale, with what it knows of the project, and that rating is the one its policies judge and your report gives. It can be higher than your score: a lead sent low may show as medium, which a policy on critical and high still lets through.

The command says what is wrong finding by finding, and writes nothing until the list is right. What it writes is `.cybedefend/out/audit.sarif` (SARIF 2.1.0, one run of the tool `cybedefend-audit`, one rule per finding, `audit/<kind>/<band>/<finding>`, which carries the finding's title, its description and its fix): to change the audit, edit `findings.json` and run the command again. The last part of a rule's id comes from the name of the proof test, so a finding stays the same finding in the dashboard when its line or its words change. Rename a proof test and the dashboard takes it for a new finding: keep the names.

## 5. Keep what is still true

The dashboard treats each import as the whole picture of its tool on the branch: a `cybedefend-audit` finding your new file no longer has is marked resolved. A review is not repeatable to the line, so:

1. Write this run's findings, the ones of the files you reviewed (`findings.json`, then `write-audit`; an empty list is a valid file).
2. `node <skill>/scripts/cybedefend.mjs keep --reviewed <the files you reviewed, separated by commas>` does the rest when `.cybedefend/audit/last.sarif` exists: a result of the last audit in a file you did not review goes back into the new file as it is. A kept result follows its line when its file changed around it; the command names the ones it could not follow, for you to correct.
3. It also names each result of the last audit that is in a file you did review and not in your new file. For each: read the code again and run its proof test. Still failing: put it back in `findings.json`, then `write-audit` and `keep --reviewed` again. Passing: it is fixed, leave it out.
4. A result that comes back from an older audit may lack a field the check now asks for (a `fix`): add it in `.cybedefend/out/audit.sarif`, under the result's `properties`.

A fix has its own order ([fix.md](fix.md), step 6): `keep --fixed`, alone.

## 6. Check it, then send it

1. Save the map in `.cybedefend/audit/map.md`. `finish` checks the audit file and the map together before it sends anything; to check them earlier:

   ```bash
   node <skill>/scripts/cybedefend.mjs check .cybedefend/out/audit.sarif --type sast --audit --map .cybedefend/audit/map.md
   ```

   It refuses what `write-audit` refuses (a proven finding without its test or its fix, a lead that could block, two results of one rule on one line), and a row of the map without a verdict. An audit with no finding is a valid file with no result: a small or careful repository can have none, and you never add one to have something to show.
2. `node <skill>/scripts/cybedefend.mjs finish` sends it: the audit joins the run of this scan (so the policies apply to it too), each proven finding is set `proven` in the dashboard with its failing test as the reason, and the file is copied to `.cybedefend/audit/last.sarif` for the next review. Alone: `node <skill>/scripts/cybedefend.mjs import .cybedefend/out/audit.sarif --type sast --add-to-run`, then `node <skill>/scripts/cybedefend.mjs prove`.
3. `.cybedefend/audit/` (the map and `last.sarif`) belongs in git with the proof tests, so the next review, on any machine, starts from them: tell the user, who commits them with their change.

## 7. Tell the user

How many entry points you reviewed and how many are sound, how many findings proven, how many leads, and when the two checks ran what the coverage check added and how many proofs held when a second agent tried to break them, the most serious in one line each, and the test files you added. Change no application code during the audit: fixing is the next step, `/cybedefend fix`, and each proof test is already there for it.
