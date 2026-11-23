# Surface: data and its copies

Read this page when the repository stores data for several tenants or with access rules, and copies it somewhere: a cache, a search index, embeddings, thumbnails, files and their links, analytics and logs, exports, reports, backups, imports and restores, migrations; or when it promises deletion, revocation or retention. The method is to follow **one record through every copy and every change of state**, and check the rule at each one.

**What counts.**
- A tenant or owner column on a record is not isolation. Find the query, key, path or policy that enforces it, for each read and each write.
- Data that is clean in its table can leak from a copy with other rules: the search index, the cache, the export, the preview, the log, the backup.
- Deletion and revocation are promises with a scope. Check the current, historical, cached, indexed, exported, restored and queued copies within what the product promises.
- A privacy preference with no access rule behind it is not a flaw. The flaw is a reader who may not see the data, or an operation that should have stopped.
- Storage settings outside the repository (a bucket policy, a CDN, a replica, a backup's access) are unknown: the flaw is a lead that names the setting.

## Tenants and objects

- Every read, update, delete, list, count and bulk query: bound to the caller's tenant or owner in the query itself, on the direct path and on the nested, background, admin, import and legacy paths. No body field that supplies the tenant.
- Cache keys, object paths, unique constraints, search document ids, temporary files and deduplication keys that leave out the tenant: two tenants meet on the same key and read or overwrite each other.
- A row policy, an ORM default scope and a raw query or a service client that do not apply the same filter: joins, aggregates, views, `unscoped`, a missing context that means "no filter".
- An object key, attachment id, version id, shared link or signed address that allows more objects, versions, operations or time than the person who made it could, or that keeps working after the access was taken away.

## Copies that leak

- A search result, cache entry, embedding, thumbnail, feed or preview that still shows a record after its rights changed or it was deleted; a filter applied when the document was indexed and never when it is read back.
- Logs, traces, analytics and diagnostics that carry private content or credentials into a system with wider access or longer retention.
- Counts, filters, sort orders, unique-name errors and timings that tell a caller whether a record they may not see exists. Name the secret that leaks; a general difference in responses is not enough.

## Exports, imports, backups, migrations

- An export, report, portability package or backup that holds other tenants' rows, fields the caller may not read, deleted data, secret values or history: rights checked on each item after selection, and again on the download of the file.
- An import or a restore that skips the owner, schema, rights, uniqueness or validation rules, overwrites existing records, or creates them in a tenant the caller cannot write. The archive's content is input.
- A migration: old rows without the tenant or rights fields, ids that collide, readers old and new that apply different defaults while the change rolls out or rolls back.

## Deletion and revocation

- A soft-deleted or revoked record that a direct lookup, a search, a relation, a link, a background job or a restore still returns or acts on; an identifier freed by a deletion and taken again while references to it remain.
- A removed member, a lowered role, a withdrawn consent or a revoked secret that a session, cache, subscription, job or precomputed table keeps honoring.
- A deletion done in the main table while a queued job, a retry, an export or an analytics copy recreates or keeps the data.
- A backup, undo or undelete that brings back data, memberships or rights that today's rules forbid.

**Follow one record.** Pick a protected record and draw its write, its queries, its cache, its index, its events, its exports, its backups, its deletion and its restore, with the tenant and the person at each step. Start with the paths that run without the request's identity: background jobs, migrations, global unique names, cache keys, service clients.

**Prove it.** Two throwaway tenants in the repository's own test fixtures, through the real service methods: write as one, read through the copy as the other; delete or revoke, then read through the copy again; export or restore, then check what came out. Assert the guarantee: the other tenant's record is absent, the deleted record is gone from the copy.

**Kinds:** `missing-tenant-filter`, `shared-key-between-tenants`, `cache-shared-between-users`, `export-beyond-rights`, `restore-without-current-rights`, `deleted-data-still-reachable`, `signed-link-overreach`, `rights-kept-after-removal`, `sensitive-data-exposure`, `secret-in-logs`.

Adapted in part from the security-audit skill of Cloudflare, under the MIT License: see [NOTICE](../NOTICE).
