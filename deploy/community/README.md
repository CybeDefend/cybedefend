# CybeDefend AppSec Community Edition: self-hosting

This directory starts the whole CybeDefend AppSec Community Edition with one
`docker compose up -d`: the web interface, the API, the six backend services,
their workers, and the infrastructure they need (PostgreSQL, Redis, Permify,
S3 storage).

The Community Edition is **open source under the GNU Affero General Public
License v3 (AGPL-3.0-only), free to self-host**. Read `LICENSE` at the root of
the repository for the full terms. The network clause (AGPL section 13): if you
modify it and let users interact with it over a network, you must offer them
your modified source.

The edition sends **no telemetry** to CybeDefend: no usage ping, no analytics,
nothing. Observability (OpenTelemetry) is off (`OTEL_DISABLED=true`); turn it on
only to send traces and logs to your own OTLP backend.

## Requirements

- Docker with **Docker Compose 2.24.4 or later** (`docker compose version`).
- **4 GB of RAM** for the containers.
- To run the smoke test (`deploy/community/smoke.sh`): **Node.js 22 or later** as well.

The stack brings its own **PostgreSQL 18**, the only database it uses: one
server, one database per service, created on first start by
`postgres/init.sql`.

## Quick start

```bash
cd deploy/community
(umask 077 && openssl rand -base64 32 > secret-key)
cp .env.example .env
```

`secret-key` is the master key of the instance, a file readable by you alone
(mode 600). See [The secret key](#the-secret-key) before you go further.

Set the two required values in `.env`:

| Variable | What to put there |
|---|---|
| `CYBEDEFEND_SETUP_TOKEN` | `openssl rand -base64 32`. Asked once, by the setup page. |
| `CYBEDEFEND_PUBLIC_URL` | The address users open, without a trailing slash. Default `http://localhost:8080`. |

No database password to choose: every password of the stack, the PostgreSQL
superuser's included, is derived from the master key.

```bash
docker compose up -d
docker compose ps        # wait until every service is healthy (a few minutes on first start)
```

Open `CYBEDEFEND_PUBLIC_URL`. On a new instance the interface opens the
**setup page**: enter the setup token, then the first administrator's e-mail,
name and password (12 to 128 characters) and the name of the organisation. The
setup page closes for good once the first administrator exists.

Who may create an account afterwards is `AUTH_SIGNUP_MODE`: `invite_only` (the
default, an administrator invites each user) or `open` (anyone who reaches the
sign-up page).

**`open` does not verify e-mail addresses.** Anyone who reaches the instance can
register any address, a colleague's included, before that colleague is invited.
The personal access tokens such an account creates stay valid after a password
reset of that address. Keep `invite_only` (the default, and the recommended
mode); use `open` only on an instance that trusted users alone can reach.

## What runs

Three containers publish a port on the host:

| Container | Host port | Purpose |
|---|---|---|
| `dashboard` | `CYBEDEFEND_HTTP_PORT` (8080) | nginx: the web interface, and the API under `/api` |
| `storage` | `CYBEDEFEND_STORAGE_PORT` (9000) | S3 storage: browsers download reports and upload files with signed URLs |
| `mcp` | `CYBEDEFEND_MCP_PORT` (3010) | The MCP server for coding agents |

Everything else is on internal networks only. `front`
(`CYBEDEFEND_SUBNET`, default `172.30.240.0/24`) holds `dashboard`,
`mcp` and the `gateway` they talk to; `cybedefend`, the back
network, holds every other service, the gateway included. `dashboard` and
`mcp` reach the gateway and nothing behind it (`mcp` keeps its sessions
in a Redis of its own, `mcp-redis`).

Every container runs on a read-only root filesystem. What it writes goes to
its volumes and to `/tmp`: memory for most, a disk volume of its own for
`analysis-reporting`, `file-management` and `external-integrations` and their
workers, which unpack archives, clone repositories and render reports there.

The services also authenticate each other: every internal gRPC call carries a
token signed with a key derived from `CYBEDEFEND_SECRET_KEY`, and a call
without a valid one is refused, so a container that only shares a network
with them cannot act as a user. Nothing to configure.

### Published ports listen on 127.0.0.1

Both ports, and the MCP server's, listen on `CYBEDEFEND_BIND_ADDRESS`, by
default `127.0.0.1`: only the host itself reaches them, over plain HTTP. Docker
writes its own firewall rules for a published port, ahead of the host's (`ufw`,
`firewalld`), so a port published on `0.0.0.0` is open to every network the
host is on whatever the host firewall says.

- **On a server, the TLS proxy is the only listener you expose.** Run it on the
  same host, in front of `127.0.0.1:8080` and `127.0.0.1:9000` (see
  [HTTPS](#https)), and leave `CYBEDEFEND_BIND_ADDRESS` unset.
- **Proxy on another host**, or a scan cluster that reaches the instance
  without a proxy: set `CYBEDEFEND_BIND_ADDRESS` to the address of the one
  interface that network reaches (`CYBEDEFEND_BIND_ADDRESS=10.0.0.12`), and
  filter it there.
- **`CYBEDEFEND_BIND_ADDRESS=0.0.0.0`** only for a quick test on a network you
  trust: it serves sign-in and the API in clear to anyone who reaches the host.

`CYBEDEFEND_EDITION=community` must be a **real environment variable of each
container**; the compose file sets it. A value written only in a service's own
`.env` file is ignored.

### Storage

The services use the S3 API, nothing specific to one product:

- inside the network they reach the storage at `http://storage:9000` (`S3_ENDPOINT`), bucket `cybedefend`, region `us-east-1`;
- the URLs handed to browsers (report downloads, uploads) are signed for `CYBEDEFEND_STORAGE_PUBLIC_URL` (`S3_PUBLIC_ENDPOINT`), default `http://localhost:9000`. Set it to the address browsers reach the `storage` container on, for example `https://storage.example.com` behind your TLS proxy;
- the storage's secret key is derived from `CYBEDEFEND_SECRET_KEY` by the `init-secrets` job, for the storage containers and file-management only; you never set it.

The bundled storage is **SeaweedFS**, from the pinned SeaweedFS image of
`docker-compose.yml`. (MinIO is not used: it publishes no community image any
more.) It runs as two containers sharing one network namespace: `storage`, an
nginx relay that owns the namespace and is the only thing listening on the
network (port 9000, also published to the host), and `storage-server`,
SeaweedFS, which joins it and listens on loopback only. Its data lives in the
`storage-data` volume; the `storage-init` job creates the bucket.

An uploaded source archive is filtered before it is scanned: source code,
build and lock files, configuration and data files (`.properties`, `.cfg`,
`.env*`, `.csv`, `.txt`, `*.example`…), keys and certificates are kept at any
depth; images, media, binaries, archives, logs and the dependency and build
output folders (`node_modules`, `vendor`, `dist`, `build`, `target`…) are
dropped.

An uploaded source archive is refused, and its scan fails with its code and
the limit named (see [When a scanner fails](#when-a-scanner-fails)), when it is
larger than 5 GiB, holds more than 200,000 entries, or inflates past 5 GiB in
total or 1 GiB for one entry: the sizes the archive declares are checked before
it is filtered, and the bytes it really inflates to while it is. What is kept
for the scanners must also fit what a scanner pod accepts: 2 GiB as a ZIP and
3 GiB unpacked, checked before any pod starts. `file-management` and
`file-management-cron` also run under a memory limit
(`CYBEDEFEND_FILE_MANAGEMENT_MEMORY`, 1g, and
`CYBEDEFEND_FILE_MANAGEMENT_CRON_MEMORY`, 2g).

If `storage-server` stops, Docker restarts it and it rejoins the relay. If the
relay itself is restarted on its own (`docker restart` of that one container),
`storage-server` keeps the old namespace and port 9000 stops answering: restart
both with `docker compose restart storage storage-server`.

## HTTPS

The refresh cookie (`cd_refresh`) is always `Secure`. Browsers accept a
`Secure` cookie on `http://localhost` (Chrome and Firefox do; check Safari), so
an evaluation on your own machine works over plain HTTP. **Anywhere else, sign-in
works only behind TLS.**

`AUTH_COOKIE_INSECURE_LOCALHOST=true` drops the `Secure` flag, for a browser that
refuses it on localhost, or for a public URL on `host.docker.internal` (the
address a local cluster's scan pods reach, see
[Run scans on a Kubernetes cluster](#run-scans-on-a-kubernetes-cluster)), on
which every browser refuses a `Secure` cookie over HTTP. The gateway refuses to
start with it unless the host of `CYBEDEFEND_PUBLIC_URL` is `localhost`,
`127.0.0.1` or `host.docker.internal`.

Put your TLS proxy in front of the `dashboard` container and forward
**everything** to it, `/api` included. For example, with nginx:

```nginx
server {
    listen 443 ssl;
    server_name appsec.example.com;
    ssl_certificate     /etc/ssl/appsec.example.com.pem;
    ssl_certificate_key /etc/ssl/appsec.example.com.key;
    client_max_body_size 101m;  # an import: a SARIF and an SBOM, 50 MB each

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering off;    # the live updates are server-sent events
        proxy_read_timeout 1h;
    }
}
```

The storage needs a server of its own, since browsers and scan pods use the
signed URLs on its address. Keep the `Host` the URLs are signed for:

```nginx
server {
    listen 443 ssl;
    server_name storage.example.com;
    ssl_certificate     /etc/ssl/storage.example.com.pem;
    ssl_certificate_key /etc/ssl/storage.example.com.key;
    client_max_body_size 101m;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_request_buffering off;
        proxy_buffering off;
    }
}
```

Then set `CYBEDEFEND_PUBLIC_URL=https://appsec.example.com` and
`CYBEDEFEND_STORAGE_PUBLIC_URL=https://storage.example.com`, and run
`docker compose up -d` again. The published ports stay on `127.0.0.1`: the
proxy is the only listener on the network.

### Behind your own proxy

- The front believes the `X-Forwarded-Proto` of a request (which turns
  `Strict-Transport-Security` on and tells the gateway the scheme) only when
  the connection comes from an address of `CYBEDEFEND_TRUSTED_PROXIES`;
  from anyone else it uses the scheme of the connection itself. Behind a TLS
  proxy, list it there, or no `Strict-Transport-Security` header is sent.
- The bundled nginx overwrites `X-Forwarded-For` with the address it sees: a
  client cannot choose the address the gateway's rate limits count. Behind your
  proxy, that address is **your proxy's** unless you list the proxy in
  `CYBEDEFEND_TRUSTED_PROXIES`. Without it, **every user shares one address**
  in the per-address limits: sign-in (10 per address and e-mail per 15 minutes,
  100 per address), sign-up, first-run setup, password reset and invitations
  (10 per address). Anyone can then lock an account, or the whole instance, out
  of signing in.
- `CYBEDEFEND_TRUSTED_PROXIES` (in `.env`) is a comma-separated list of IPv4 or
  IPv6 addresses or CIDRs. From a listed address the front takes the client
  address your proxy puts last in `X-Forwarded-For` (nginx:
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`; Caddy and
  Traefik send it by default), skipping the listed proxies from the right,
  and still hands the gateway that one address, never the client's header. List
  only your proxies: a listed address can claim any client address. A value
  that is not an address or a CIDR, or a prefix of `/0`, stops the `dashboard`
  container at start with a message (`docker compose logs dashboard`).
  - Proxy on the same host, reaching the published port: list the gateway of
    the front network, the first address of `CYBEDEFEND_SUBNET`
    (`CYBEDEFEND_TRUSTED_PROXIES=172.30.240.1` with the default subnet).
  - Proxy on another host: its address as the front sees it, for example
    `CYBEDEFEND_TRUSTED_PROXIES=10.0.0.5`, or its subnet,
    `CYBEDEFEND_TRUSTED_PROXIES=10.0.0.0/24,fd00:10::/64`.

  To check, sign in through the proxy and read the address at the start of
  the front's access log lines (`docker compose logs dashboard`): before the
  setting it is the proxy's, after it the browser's. Then run
  `docker compose up -d` again after each change of `.env`.
- The MCP server is published on its own port, not behind the front, and
  limits each client address to 120 requests a minute, failed sign-ins
  included. Behind your TLS proxy every agent reaches it from the proxy's
  address, so one client without a token could use up the limit for all of
  them. The MCP server takes the client address from `X-Forwarded-For` only
  from the addresses of `CYBEDEFEND_TRUSTED_PROXIES` too: list your proxy
  there, as seen from the MCP server's container.
- The front's access log writes `***` in place of the token in `/invite/…`,
  `/api/auth/invitations/…` and `/api/webhooks/jira/…`, and no query string.
  An invitation link accepts the invitation with its token alone, and the Jira
  webhook's path is the secret that authenticates Jira's calls: your proxy
  should not log those paths either, or should mask them the same way (with nginx, a `map` on
  `$request_uri` and a `log_format`, as `nginx/nginx.conf` here does; Caddy and
  Traefik write no access log unless you turn it on).
- The refresh cookie's path is `/api/auth` (`AUTH_COOKIE_PATH`). It stays right
  as long as the gateway is reached under `/api`, which is what the bundled nginx
  does; do not rewrite that prefix in your proxy.

## The secret key

The master key of the instance (at least 32 random bytes, base64 or hex) is
the file `secret-key` next to `docker-compose.yml`, or the path
`CYBEDEFEND_SECRET_KEY_PATH` names in `.env`. Create it once, readable by you
alone:

```bash
(umask 077 && openssl rand -base64 32 > secret-key)   # mode 600
```

Compose mounts it into the `init-secrets` job alone, as a secret: it is never
an environment variable, so `docker inspect` of no container shows it, and
that job has no network. A missing file stops `docker compose up` with the
path it looked for. Git ignores `secret-key` (`.gitignore`).

Every encryption key is derived from the master key: the keys that
encrypt the integration credentials (GitHub, GitLab, registries, Jira, Slack),
the values of secret findings, the sign-in signing keys, the storage's
secret key, the key Permify requires on every call and the password Redis
requires.

Redis accepts no command from a client that has not authenticated. The
`init-secrets` job writes its password to Redis's own secrets volume and to
each service's; each service's start hook (`runtime/redis-auth.cjs`, loaded
through `NODE_OPTIONS`) hands it to its Redis clients. You never set it. To use
`redis-cli` by hand:
`docker compose exec redis sh -c 'REDISCLI_AUTH="$(cat /run/cybedefend-secrets/redis-password)" redis-cli'`.

Permify, the authorization service, answers only the calls that carry its
preshared key: without it, any container on the network could grant itself
any role. The `init-secrets` job derives that key and writes the Permify
configuration that enforces it to Permify's own secrets volume, and the key
itself to the volumes of its only callers: the schema job, `gateway` and
`global-management`.

The internal gRPC calls between the services are signed: each service signs
with a key of its own (`SERVICE_AUTH_KEY_FILE`), and each server holds the
keys of the services allowed to call it, and only those
(`SERVICE_AUTH_PEER_KEY_<CALLER>` in `SERVICE_AUTH_PEER_KEYS_DIR`).
`init-secrets` derives them all. A container that holds no key is refused,
even on the back network, and a compromised service can sign only as itself:
it cannot claim to be the gateway, the one service that may act for a user.
Known limit: the calls are not encrypted, so someone who can read the traffic
of the back network can replay a signed call to the same method for up to
five minutes.

- **Only one container receives it:** the one-shot job `init-secrets`, with no
  network, which
  derives every key and every database password from it into one volume per
  consumer (`secrets-<consumer>`, each file mode 0400, owned by the uid that
  reads it). Each service mounts its own volume only, at
  `/run/cybedefend-secrets`, and reads there only the keys it uses
  (`<KEY>_FILE`): the key that seals the sign-in signing keys reaches
  global-management alone. A compromised container learns its own service's
  secrets, not the master key nor another service's.
- **It must never change.** With another key, nothing encrypted before can be
  read, and every user is signed out.
- **Back it up**, apart from the volumes. A backup of the volumes without the
  key cannot be used.
- An instance installed before the key file has the key as
  `CYBEDEFEND_SECRET_KEY` in `.env`. That still works: `init-secrets` reads it
  when the key file is empty, or holds the same key, and warns at each start.
  Two different keys stop it. Move the key to the file (see
  [Upgrade](#upgrading-from-a-version-with-the-master-key-and-postgres_password-in-env)).

## Database roles

Each service reaches the single PostgreSQL as its own role, named after its
database (`cybedefend_global_management`, `cybedefend_scanning`,
`cybedefend_analysis_and_reporting`, `cybedefend_file_management`,
`cybedefend_external_integrations`, `cybedefend_policy`, `permify`). A role
may log in and nothing else: no superuser, no `CREATEROLE`, no `CREATEDB`. It
owns its database and every object in it, so the service runs its own
migrations, and every other role is refused at that database. Its password is
derived from `CYBEDEFEND_SECRET_KEY`; the one-shot job `postgres-roles` sets
the roles up at every start (`postgres/roles.sh`), with the SCRAM verifiers
`init-secrets` wrote, never a password. The superuser `cybedefend` has a
password derived from the master key too, which `init-secrets` writes to the
`postgres` container's own secrets volume (`POSTGRES_PASSWORD_FILE`, read when
the data directory is new) and to the role setup job's; no `.env` value and no
container's configuration holds it. To open `psql` as the superuser:
`docker compose exec postgres psql -U cybedefend` (the socket inside the
container needs no password).

## Sessions and passwords

- An access token lives 15 minutes; the refresh cookie 30 days.
- A password change or reset signs out every refresh session of the account
  (the one that changes its password gets a new one). An access token already
  issued stays valid up to 15 minutes.
- **Personal access tokens stay valid after a password change or reset.** To
  cut them, revoke them from your profile in the interface, or with
  `DELETE /api/me/personal-access-tokens/<id>` (the ids are listed by
  `GET /api/me/personal-access-tokens`), using a session token: a personal
  access token cannot manage tokens.
- Removing a member from an organisation revokes every refresh session and
  every personal access token of that account, whichever organisation they were
  created for. The account must sign in again, and keeps
  access to the organisations it still belongs to.
- An expired personal access token no longer counts toward the limit of 10 per
  account, and its name can be used again.
- Without SMTP there is no reset e-mail. An administrator prints a single-use
  reset link (valid 30 minutes) with:

  ```bash
  docker compose exec -w /app/global-management-service global-management \
    node dist/main.auth-reset-password user@example.com
  ```

## Optional integrations

Each one is off until its variables are set in `.env` (every variable is listed,
commented, in `.env.example`), then `docker compose up -d`:

- **E-mail (SMTP):** `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`,
  `EMAIL_PASSWORD`, and `EMAIL_FROM`, which has no default and is required once
  `EMAIL_HOST` is set.
- **GitHub App:** `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`,
  `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_URL`.
- **GitLab:** `GITLAB_APPLICATION_ID`, `GITLAB_APPLICATION_SECRET`, and
  `GITLAB_API_URL` for a self-managed GitLab (default `https://gitlab.com/api/v4`).
- **Jira:** `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`.
- **Linear:** `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET`.
- **Slack:** `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`.

When you create the application on each provider, give it these addresses,
where `<public URL>` is `CYBEDEFEND_PUBLIC_URL`:

| Provider | Redirect (callback) URL | Webhook URL |
|---|---|---|
| GitHub App | `<public URL>/integrations/github/callback`, with « Request user authorization (OAuth) during installation » ticked | `<public URL>/api/webhooks/github`, secret `GITHUB_WEBHOOK_SECRET` |
| GitLab application | `<public URL>/integrations/gitlab/callback` | none to enter: each linked project gets `<public URL>/api/webhooks/gitlab` |
| Jira (Atlassian OAuth 2.0 app) | `<public URL>/integrations/jira/callback` | none to enter: registered on connection |
| Linear | `<public URL>/integrations/linear/callback` | `<public URL>/api/webhooks/linear`, secret `LINEAR_WEBHOOK_SECRET` |
| Slack app | `<public URL>/integrations/slack/callback` | none |

The webhooks registered on your behalf point at `<public URL>/api`, so the
provider must be able to reach that address.

The GitHub App's private key is easier to give as a file: put it in the
`github` folder as `private-key.pem`, readable by user 10001
(`github/README.md`), which every external-integrations container mounts
read-only, and set `GITHUB_PRIVATE_KEY_FILE=/run/cybedefend-github/private-key.pem`
instead of `GITHUB_PRIVATE_KEY`. Another multi-line value can be given the
same way: mount its file in a `docker-compose.override.yml` and set
`<VARIABLE>_FILE` to its path inside the container. A `*_FILE` variable is
read once at start, trailing whitespace removed.

`env-inventory.json` lists every variable the services read, and whether the
Community Edition needs it (`required`, `optional`), sets it itself
(`internal`, `derived`, `default`), or ignores it (`cloud-only`, `unused`).

## Importing results

By default the instance runs no scanner itself: you import SARIF produced by
your own tools, from CI or from the interface. (To run the scanners on your
own Kubernetes cluster instead, see
[Run scans on a Kubernetes cluster](#run-scans-on-a-kubernetes-cluster).
Imports keep working either way.) Create a **personal access token** first
(from your profile in the interface, or with `POST /api/me/personal-access-tokens`
`{ "name": "ci" }` and a session token: a personal access token cannot create
another one). It starts with `cdp_` and is shown once.

```bash
curl -H "Authorization: Bearer cdp_…" \
  -F file=@results.sarif -F type=sast -F branch=main \
  "$CYBEDEFEND_PUBLIC_URL/api/project/<projectId>/scan/import/start"
```

- The parts may come in any order. `type` is `sast`, `iac`, `secret`, `cicd`,
  `sca` or `container`. A gzipped file is sent as `results.sarif.gz`. A file is
  at most 50 MB (200 MB decompressed), 100,000 results and 20 runs.
- What the import holds in memory is bounded too, whatever the compression:
  per run, 50,000 rules and 200,000 artifacts; the run headers of a file (tool
  descriptions, base URIs, artifact locations), 2,000,000 values and 128 Mi
  characters of text; one result, 100,000 values and 4 Mi characters of text
  (a value is any object, array, key, string, number, boolean or null).
  Scanner output stays far below these. A file over one fails the scan with
  `IMPORT_TOO_LARGE`.
- A rule your import describes (its title, description and help) is kept for
  your organisation only: another organisation importing a rule of the same
  id gets its own.
- The answer is `202 { "scanId": "…" }`. Follow the scan with
  `GET /api/project/<projectId>/scan/<scanId>`: a failed scan names its code in
  `errorMessage` (for example `IMPORT_INVALID_SARIF`).

Until a CLI release supports this edition, check the CLI by hand: run its
import against your instance with a `cdp_` token and `--api-url
<CYBEDEFEND_PUBLIC_URL>/api`.

### SCA and container results

Produce SARIF with Trivy (`trivy fs --format sarif`, `trivy image --format
sarif`), Grype or osv-scanner, and import it with `type=sca`, or with
`type=container` plus `-F image=<image reference>`.

- An `sca` import is the branch's **whole** dependency picture: packages it no
  longer reports are marked resolved. Scan the repository root into one file,
  and use one SCA tool per branch.
- A `container` import is the whole picture of that image on that branch.
- An `sca` import is all or nothing: a result without a package name and
  version fails the scan with `IMPORT_UNSUPPORTED_RESULT`.

A SARIF file lists only the packages that have a vulnerability. To store the
whole inventory, add the CycloneDX SBOM of the same scan to an `sca` import:

```bash
trivy fs --format sarif     --output results.sarif  .
trivy fs --format cyclonedx --output bom.cdx.json   .
curl -H "Authorization: Bearer cdp_…" \
  -F file=@results.sarif -F sbom=@bom.cdx.json -F type=sca -F branch=main \
  "$CYBEDEFEND_PUBLIC_URL/api/project/<projectId>/scan/import/start"
```

- The `sbom` part is optional, and taken with `type=sca` only. It is a
  CycloneDX 1.4 to 1.7 JSON file, `*.json` or gzipped `*.json.gz`, with the
  same limits as the SARIF: 50 MB, 200 MB decompressed, 100,000 components,
  and at most 500,000 license entries in the whole file (`IMPORT_TOO_LARGE`
  past it).
  Syft (`syft . -o cyclonedx-json`) and cdxgen work too.
- It adds the packages without a vulnerability, the licenses, and whether a
  package is a direct or a transitive dependency (from the SBOM's
  `dependencies`; without them, the instance does not say).
- Send it with the SARIF of the same scan, never alone: the SARIF and the SBOM
  are one picture of the branch, and the next `sca` import replaces both. An
  `sca` import without an SBOM keeps only its vulnerable packages.
- A component is a package when it is a `library` or a `framework` with a
  `purl`; the others are counted and skipped. A package is a development
  dependency only when the SBOM says so (`scope: excluded`, or cdxgen's
  `cdx:npm:package:development`).
- An SBOM that cannot be read (not CycloneDX, another version, a package name
  or version no registry uses) fails the scan with `IMPORT_INVALID_SBOM`, and
  nothing of the scan is imported.
- The instance downloads **no advisory feed** (no OSV, EPSS or malware data):
  everything shown comes from the file you imported.

## Run scans on a Kubernetes cluster

Without a cluster the instance is import-only. Give it a namespace on a
Kubernetes cluster and it runs the scanners there: **Start scan** appears next
to **Import results**, an uploaded ZIP archive is scanned, and a project linked
to GitHub or GitLab can be scanned on every push. Imports keep working.

To try it on one Mac, with the instance in Docker and the cluster on the same
machine, follow [A local cluster (OrbStack)](#a-local-cluster-orbstack).

For each scan, `security-scanning` starts one pod per enabled scanner, in your
namespace. A pod downloads the archive from the storage, runs its tool, and
sends the SARIF back to the instance with a single-use upload token. The
results then go through the same pipeline as an import.

The SCA pod (Trivy filesystem) also sends the package inventory, a CycloneDX
SBOM, in the same upload as its SARIF. The branch then shows every package,
with its licenses and whether it is a direct or a transitive dependency, as an
`sca` import with an SBOM does (see
[SCA and container results](#sca-and-container-results)). The SARIF and the
SBOM are imported together or not at all: an SBOM the instance cannot read
fails the SCA scanner, with `IMPORT_INVALID_SBOM` (or code 86 when the upload
itself is refused), and the results of the other scanners are kept. An image older than this release sends the SARIF alone, and
the branch shows only its vulnerable packages.

| Project setting | Scanner | Image | CPU request / limit | Memory request / limit |
|---|---|---|---|---|
| SAST | Opengrep | `cybedefend-scanners/opengrep` | 500m / 1 | 1Gi / 2Gi |
| SAST (CI/CD workflows) | zizmor | `cybedefend-scanners/zizmor` | 100m / 500m | 256Mi / 512Mi |
| Secrets | Gitleaks | `cybedefend-scanners/gitleaks` | 250m / 500m | 512Mi / 1Gi |
| IaC | Trivy (config) | `cybedefend-scanners/trivy-config` | 250m / 1 | 512Mi / 1Gi |
| SCA | Trivy (filesystem) | `cybedefend-scanners/trivy-fs` | 500m / 1 | 1Gi / 2Gi |

Every pod also requests 1Gi of `ephemeral-storage`, limited to 5Gi.

The scanners are open source, in the [`cybedefend-scanners`](https://github.com/CybeDefend/cybedefend-scanners)
repository, which publishes their images as
`ghcr.io/cybedefend/cybedefend-scanners/<scanner>`.

### What the cluster must allow

- **The namespace.** The instance needs a ServiceAccount there that may
  create, get, list and delete pods, and create and delete secrets. Nothing
  else: it never lists or reads secrets (a list returns their values), and it
  never touches another namespace. At start, and every 5 minutes while it
  fails, it checks those six permissions with a `SelfSubjectAccessReview`,
  which every authenticated identity may create.
- **The pods.** They run as user 65532, non-root, with a read-only root
  filesystem, no Linux capability, the `RuntimeDefault` seccomp profile and
  `automountServiceAccountToken: false`: no ServiceAccount token is mounted
  into a scan pod. Their archive URL and upload token come from a Secret of
  their own, never from the command line.
- **The network, from the pods:**
  - `CYBEDEFEND_PUBLIC_URL`: the pods send their results to the API under
    `/api` (`POST /api/scan-runs/<scanId>/results`);
  - `CYBEDEFEND_STORAGE_PUBLIC_URL`: the pods download the archive from the
    storage with a signed URL;
  - `ghcr.io`, to pull the images (or your registry, see
    `CYBEDEFEND_SCANNER_IMAGE_REGISTRY`);
  - for the SCA scanner (`trivy-fs`), Trivy's vulnerability database, which it
    downloads at each scan: `mirror.gcr.io` by default, `ghcr.io` as Trivy's
    fallback.

  `localhost` in either URL is the pod itself: use addresses the cluster can
  reach. Behind the TLS proxy of [HTTPS](#https) these are the proxy's
  addresses, and the published ports stay on `127.0.0.1`. Without a proxy, the
  pods reach the published ports themselves: set `CYBEDEFEND_BIND_ADDRESS` to
  the host interface the cluster reaches (see
  [Published ports listen on 127.0.0.1](#published-ports-listen-on-127001)).
  On one Mac with OrbStack, nothing to set: `host.docker.internal` reaches the
  Mac's loopback. The service logs `CLUSTER_SCANNING_UNREACHABLE_ADDRESS
  variable=FRONTEND_URL` (the public URL) or `variable=S3_PUBLIC_ENDPOINT`
  (the storage URL) when one of them is a loopback address.
- **The network, from the instance:** `security-scanning` must reach the
  cluster's API server, at the `server` address of the kubeconfig.

### 1. Create the namespace and its ServiceAccount

Give each instance a namespace of its own: one namespace per instance. Pods
and Secrets are told apart by an instance label (see
[When a scanner fails](#when-a-scanner-fails)), but a namespace shared by two
instances shares its quotas and its RBAC.

`cybedefend-namespace.yaml`, next to this README, holds it. Its label makes Kubernetes enforce the
`restricted` Pod Security Standard in the namespace; the scan pods already meet
it (non-root, no privilege escalation, every capability dropped, the
`RuntimeDefault` seccomp profile, no host path).

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cybedefend-scans
  labels:
    pod-security.kubernetes.io/enforce: restricted
```

Then `cybedefend-scanner.yaml`, next to it, holds the ServiceAccount, its Role,
the RoleBinding and a long-lived token for it. Replace `cybedefend-scans` with
your namespace in every place, in both files. The `cybedefend-ignore` comments
tell a code scanner why each of these grants is needed; they change nothing in
Kubernetes.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: cybedefend-scanner
  # cybedefend-ignore[CD-IAC-0325]: a namespace of its own, one per instance; the Role below grants nothing outside it
  namespace: cybedefend-scans
automountServiceAccountToken: false
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: cybedefend-scanner
  namespace: cybedefend-scans
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["create", "get", "list", "delete"] # cybedefend-ignore[CD-IAC-1337]: one pod per scan; the namespace enforces the restricted Pod Security Standard, so no privileged or host pod is admitted
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: cybedefend-scanner
  namespace: cybedefend-scans
subjects:
  - kind: ServiceAccount
    name: cybedefend-scanner
    namespace: cybedefend-scans
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: cybedefend-scanner
---
apiVersion: v1
kind: Secret
metadata:
  # cybedefend-ignore[CD-IAC-2468]: the long-lived token the kubeconfig carries; it may only manage pods and Secrets in this namespace, and deleting this Secret revokes it
  name: cybedefend-scanner-token
  namespace: cybedefend-scans
  annotations:
    kubernetes.io/service-account.name: cybedefend-scanner
type: kubernetes.io/service-account-token
```

Create the namespace:

```bash
kubectl apply -f cybedefend-namespace.yaml
```

Then apply the second file:

```bash
kubectl apply -f cybedefend-scanner.yaml
```

Optionally, `cybedefend-scanner-networkpolicy.yaml`, next to them, limits what
the scan pods reach. It denies every connection to them, and lets them reach
only the cluster's DNS and the instance; the SCA pod (`trivy-fs`) may also
reach public addresses on port 443, for its vulnerability database. A
NetworkPolicy names addresses, not hosts: replace `192.0.2.10/32` with the
address that `CYBEDEFEND_PUBLIC_URL` and `CYBEDEFEND_STORAGE_PUBLIC_URL`
resolve to from the cluster, and `443` with their ports if no TLS proxy fronts
them (8080 and 9000 by default). Replace `cybedefend-scans` here too. The
policy works only on a cluster whose network plugin enforces NetworkPolicies
(Calico, Cilium and most managed clusters do; check yours): elsewhere it is
accepted and changes nothing.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: cybedefend-scan-pods
  namespace: cybedefend-scans
spec:
  # Every pod of the namespace, which holds only this instance's scan pods:
  # deny by default, then allow the flows below.
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  # No ingress rule: nothing may connect to a scan pod.
  ingress: []
  egress:
    # DNS, to the cluster's resolver only. Its label differs on some
    # distributions: kubectl -n kube-system get pods --show-labels
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    # The instance: the pods download the archive from
    # CYBEDEFEND_STORAGE_PUBLIC_URL and send their results to
    # CYBEDEFEND_PUBLIC_URL. Replace 192.0.2.10/32 with the address those
    # hosts resolve to from the cluster (one entry per address), and 443 with
    # their ports: behind the TLS proxy both are on 443; without it, the
    # published ports (8080 for the instance, 9000 for the storage).
    - to:
        - ipBlock:
            cidr: 192.0.2.10/32
      ports:
        - protocol: TCP
          port: 443
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: cybedefend-scan-pods-sca-database
  namespace: cybedefend-scans
spec:
  # The SCA scanner (Trivy filesystem) downloads its vulnerability database at
  # each scan, from mirror.gcr.io, then ghcr.io. A NetworkPolicy cannot name
  # a host, so this pod alone may reach public addresses on 443; the private
  # ranges (the cluster, your network, the cloud metadata address) stay
  # closed. With an egress proxy or a firewall that filters by host name,
  # delete this policy and allow those two hosts there instead.
  podSelector:
    matchLabels:
      app.kubernetes.io/managed-by: cybedefend
      cybedefend.io/adapter: trivy-fs
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
              - 169.254.0.0/16
              - 100.64.0.0/10
              - 127.0.0.0/8
      ports:
        - protocol: TCP
          port: 443
```

Apply it once edited:

```bash
kubectl apply -f cybedefend-scanner-networkpolicy.yaml
```

A scanner that fails with code 88 (the archive could not be downloaded) or 86
(the pod could not reach the instance) right after applying it usually means a
wrong address or port in the policy's second rule.

The `cybedefend-scan-pods-sca-database` policy lets the SCA scanner reach
any public address on 443, because Trivy downloads its databases at each
scan. To keep that pod off the internet, mirror those databases in your own
registry, set `CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY` and
`CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY` (see [Settings](#settings)), and
replace that policy's rule with your mirror's address. That choice is yours,
as the cluster's operator.

### 2. Write the kubeconfig

The instance accepts a kubeconfig whose user holds a `token`, a client
certificate, or a user name and password, written in the file itself. It
refuses a user that runs an `exec` or `auth-provider` plugin
(`aws eks get-token`, `gke-gcloud-auth-plugin`, `kubelogin`, OIDC): the image
ships none of them. It logs `CLUSTER_KUBECONFIG_PLUGIN_UNSUPPORTED` and
`CLUSTER_SCANNING_DISABLED reason=kubeconfig_unreadable`. So the kubeconfig you
use with `kubectl` is usually not the one to give it: write one for the
ServiceAccount above.

The instance verifies the API server's certificate: against the
`certificate-authority-data` of the cluster, or the system's trusted
authorities when there is none. It refuses a cluster with
`insecure-skip-tls-verify: true`, or a plain `http://` server, which many
local kubeconfigs carry: anyone on the path could read the token. It logs
`CLUSTER_KUBECONFIG_INSECURE_TLS setting=insecure-skip-tls-verify` (or
`setting=http-server`) and `CLUSTER_SCANNING_DISABLED reason=insecure_tls`.
Give the cluster's CA instead, as below. On a test cluster only, set
`CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS=true` to accept such a kubeconfig;
`security-scanning` then logs `CLUSTER_SCANNING_INSECURE_TLS_ALLOWED` at every
start.

Inline credentials are recommended: a `token`, or `client-certificate-data` and
`client-key-data`. A client certificate given as file paths (`client-certificate`
and `client-key`, which the client reads as `certFile` and `keyFile`) is
accepted too. Those paths are read inside the `security-scanning` and
`security-scanning-cron` containers, so the files must sit under the read-only
`/run/cybedefend-cluster` mount, for example `cluster/client.crt` written as
`/run/cybedefend-cluster/client.crt`.

Read the token of the ServiceAccount:

```bash
kubectl -n cybedefend-scans get secret cybedefend-scanner-token -o jsonpath='{.data.token}' | base64 -d
```

Read the cluster's CA certificate, already in base64:

```bash
kubectl -n cybedefend-scans get secret cybedefend-scanner-token -o jsonpath='{.data.ca\.crt}'
```

Read the address of the API server:

```bash
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
```

Write `cluster/kubeconfig` (next to `docker-compose.yml`) with those three
values in place of the `<…>` placeholders:

```yaml
apiVersion: v1
kind: Config
clusters:
  - name: scans
    cluster:
      server: <the address of the API server>
      certificate-authority-data: <the base64 CA certificate>
users:
  - name: cybedefend-scanner
    user:
      token: <the token of the ServiceAccount>
contexts:
  - name: cybedefend-scanner
    context:
      cluster: scans
      user: cybedefend-scanner
current-context: cybedefend-scanner
```

The `server` address must be reachable from the `security-scanning` container.
A local cluster (kind, minikube, k3d) often prints `https://127.0.0.1:<port>`,
which is the container itself there.

The services run as user 10001 and mount `cluster/` read-only. Make the file
readable by that user only:

```bash
sudo chown 10001:10001 cluster/kubeconfig
```

```bash
sudo chmod 400 cluster/kubeconfig
```

`cluster/.gitignore` keeps every file of the folder but its README out of Git: the kubeconfig, and a certificate and key placed there. The token is a credential: it
may create pods in that namespace. Keep it as you keep `.env`.

### 3. Turn scanning on

Set, in `.env`:

```bash
CYBEDEFEND_SCANNER_KUBECONFIG_FILE=/run/cybedefend-cluster/kubeconfig
CYBEDEFEND_SCANNER_NAMESPACE=cybedefend-scans
```

Then apply it:

```bash
docker compose up -d
```

Check the result in the logs of `security-scanning`:

```bash
docker compose logs security-scanning | grep CLUSTER_
```

- `CLUSTER_SCANNING_ENABLED namespace=<namespace> instance=<id>`: scans run on the cluster.
  Until the first access check answers (at most 10 seconds after
  `security-scanning` starts), a scan start is refused with
  `SCANNERS_NOT_AVAILABLE`: wait for `CLUSTER_SCANNING_ENABLED` in the log
  before the first scan.
- `CLUSTER_SCANNING_DISABLED reason=kubeconfig_unreadable`: the file is
  missing, unreadable by user 10001, malformed, or uses a plugin.
- `CLUSTER_SCANNING_DISABLED reason=insecure_tls`: the kubeconfig turns off
  the verification of the API server (see
  [2. Write the kubeconfig](#2-write-the-kubeconfig)).
- `CLUSTER_SCANNING_DISABLED reason=cluster_unreachable`: the API server did
  not answer in time, or answered with an error.
- `CLUSTER_SCANNING_DISABLED reason=access_denied`: the API server refused the
  credentials (HTTP 401 or 403), or one of the six permissions is missing in
  that namespace.

While scanning is disabled the instance stays import-only and starts no pod.
It checks again every 5 minutes and turns scanning on without a restart once
the check passes. It reads the kubeconfig again at each check, and after the
API server refuses its token (HTTP 401): a token rotated in the same file is
picked up on its own. A new namespace (a change of `.env`) needs
`docker compose up -d`. A kubeconfig for another cluster needs a restart:

```bash
docker compose restart security-scanning security-scanning-cron
```

`security-scanning-cron` runs the scan queue and the watchdog. It mounts the
same `cluster/` folder and reads the same variables.

The interface asks `GET /api/instance/capabilities`, which answers
`{ "clusterScans": true }` once scanning is on and `{ "clusterScans": false }`
otherwise. It answers 503 `INSTANCE_CAPABILITIES_UNAVAILABLE` when
`security-scanning` cannot be asked. The interface then shows the import-only
screens and asks again once.

### Settings

Each variable is set in `.env`. An empty value counts as unset.

| Variable | Default | What it does |
|---|---|---|
| `CYBEDEFEND_SCANNER_KUBECONFIG_FILE` | unset | The kubeconfig, as a path inside the container: `/run/cybedefend-cluster/kubeconfig` for `cluster/kubeconfig`. |
| `CYBEDEFEND_SCANNER_NAMESPACE` | unset | The namespace of the scan pods (a DNS label). |
| `CYBEDEFEND_SCANNER_IMAGE_REGISTRY` | `ghcr.io/cybedefend` | Where the images are pulled from: `<registry>/cybedefend-scanners/<scanner>:<tag>`. Set it to your mirror of those images. |
| `CYBEDEFEND_SCANNER_IMAGE_TAG` | `1.0.0` | The version of the images. The default is the one this release speaks; change it only to a version that the release notes name. |
| `CYBEDEFEND_SCANNER_IMAGE_PULL_SECRET` | unset | The name of a `docker-registry` Secret, in the namespace, for a private registry. |
| `CYBEDEFEND_SCANNER_MAX_CONCURRENT` | `2` | How many scans run at once (1 to 50). Each scan runs up to five pods. |
| `CYBEDEFEND_SCANNER_RESOURCES` | the table above | JSON that overrides the requests or limits of a scanner, for example `{"opengrep":{"memoryLimit":"4Gi"}}`. |
| `CYBEDEFEND_SCANNER_KEEP_PODS` | `false` | `true` keeps the pods and Secrets of finished scans, to read their logs; a pod past its deadline is deleted anyway. |
| `CYBEDEFEND_SCANNER_ALLOW_INSECURE_TLS` | `false` | `true` accepts a kubeconfig with `insecure-skip-tls-verify: true` or an `http://` server: the API server is then not verified. For a test cluster only. |
| `CYBEDEFEND_SCANNER_TRIVY_DB_REPOSITORY` | unset | Your mirror of Trivy's vulnerability database (`host[:port]/path[:tag]`), given to the SCA scanner as `TRIVY_DB_REPOSITORY`. Unset, Trivy downloads the public one. |
| `CYBEDEFEND_SCANNER_TRIVY_JAVA_DB_REPOSITORY` | unset | Your mirror of Trivy's Java database, given to the SCA scanner as `TRIVY_JAVA_DB_REPOSITORY`. Unset, Trivy downloads the public one when the project holds Java archives. |

`CYBEDEFEND_SCANNER_KUBECONFIG_FILE` and `CYBEDEFEND_SCANNER_NAMESPACE` must be
set together, or neither: with only one of them, `security-scanning` refuses to
start and says so.

A private registry's pull Secret is created like this, in the namespace (the
instance never reads it, the kubelet does):

```bash
kubectl -n cybedefend-scans create secret docker-registry cybedefend-pull --docker-server=<registry> --docker-username=<user> --docker-password=<password>
```

### Limits

- **Concurrency.** Past `CYBEDEFEND_SCANNER_MAX_CONCURRENT` running scans, a
  new scan waits as `queued` and starts when a slot frees, oldest first. A scan
  still queued after 6 hours fails (code 65).
- **Time.** A scanner has 2 hours from the start of its scan. Its pod has an
  `activeDeadlineSeconds` of 7500 (2 hours and 5 minutes), and its tool a
  timeout of 5700 seconds (25 minutes less than 2 hours, for the download and
  the upload). A pod still `Pending` after 10 minutes, because no node can
  take it, fails its scanner (code 81).
- **The archive.** What a scanner pod downloads, the uploaded archive once
  filtered (see [Storage](#storage)), is at most 2 GiB, 3 GiB unpacked and
  200,000 entries, and no file of it over 1 GiB unpacked. Past one of them the
  scan fails (codes 90 to 93) before any pod starts. Absolute paths and `..`
  are refused (code 97), and so are encrypted archives (96);
  links are skipped. An archive with a single top folder (as GitHub's ZIP
  downloads) is scanned from inside that folder. A scan waits 30 minutes for
  its archive: past that it fails with code 98, and until then the project
  accepts no other scan (cancel it to start another).
- **No container image scans.** The cluster scans source code only. Scan an
  image with your own tool and import its SARIF with `type=container` (see
  [SCA and container results](#sca-and-container-results)).
- **Settings that stay hidden.** The fast scan mode, development and
  transitive dependencies, reachability, the AI categories, AI-BOM and AI
  review of merge requests are cloud features: the Community Edition does not
  show them, with or without a cluster. « Scan on every commit » is shown once
  a cluster runs scans, for a project linked to GitHub or GitLab.
- **The image tag.** An image older than this release does not know the pod
  mode, and an image newer than it may speak another scan protocol: both fail
  with code 84. Set `CYBEDEFEND_SCANNER_IMAGE_TAG` back to the default.

### Behind a proxy: the results route's limit

`POST /api/scan-runs/<scanId>/results` takes no session. It is limited to 60
requests a minute per client address, the address the gateway's `req.ip` holds.
The gateway trusts only the bundled front (`TRUSTED_PROXY_CIDRS`, the front
network), and the front passes on the address it sees, so that address is:

- the pod's address as it reaches the front: usually its node's, or a NAT
  gateway's, which every pod of the cluster shares;
- behind your TLS proxy or ingress, **the proxy's address**, unless you list
  the proxy in `CYBEDEFEND_TRUSTED_PROXIES` (see
  [Behind your own proxy](#behind-your-own-proxy)).

Every pod that shares one address shares those 60 requests. A pod sends one
upload, plus retries. Past the limit the gateway answers 429 `RATE_LIMITED`
with `Retry-After`: the pod waits as asked and tries again, 6 times and 5
minutes at most, then fails its scanner (code 86). With a high
`CYBEDEFEND_SCANNER_MAX_CONCURRENT`, make sure the front sees the pods' own
addresses.

### When a scanner fails

A failed scan names its code in `errorCode`, and the interface shows a
sentence for it. A scanner pod's exit code becomes one of them:

| Code | Name | What happened |
|---|---|---|
| 80 | `CLUSTER_NO_RESULTS` | The pod finished without sending its results. |
| 81 | `CLUSTER_UNSCHEDULABLE` | The pod stayed `Pending` for more than 10 minutes: no node had room for it, or a node selector or taint kept it off every node. |
| 82 | `CLUSTER_DEADLINE` | The scanner was still open 2 hours after the scan started. |
| 83 | `CLUSTER_LAUNCH_FAILED` | Kubernetes refused to create the Secret or the pod, or the scan had no pod 5 minutes after it started. |
| 84 | `CLUSTER_IMAGE_INCOMPATIBLE` | The image does not speak this release's scan mode or protocol (exit 4 or 5). |
| 85 | `CLUSTER_TOOL_FAILED` | The tool itself failed (exit 2). |
| 86 | `CLUSTER_RESULTS_REFUSED` | The results were refused, or the upload stopped (exit 3). |
| 87 | `CLUSTER_POD_LOST` | The pod disappeared before it sent its results. |
| 88 | `CLUSTER_ARCHIVE_FETCH_FAILED` | The pod could not download the archive from the storage (exit 6): check that `CYBEDEFEND_STORAGE_PUBLIC_URL` is an address the cluster reaches. The scan's message names the address the pods were given. |

The exit codes of the scanner (`cybedefend-scanner run <scanner> --scan-run`):

| Exit | Meaning | Scan code |
|---|---|---|
| Exit 0 | Done: the results were sent, or had already been sent. | none |
| Exit 2 | The tool failed. | 85 |
| Exit 3 | The pod could not reach the instance (the network path back, see [What the cluster must allow](#what-the-cluster-must-allow)), the instance refused the results, or the run was stopped. | 86 |
| Exit 4 | Configuration error, or an image without the scan mode. | 84 |
| Exit 5 | The instance refused the scan protocol: set `CYBEDEFEND_SCANNER_IMAGE_TAG` to a supported version. | 84 |
| Exit 6 | The archive could not be downloaded. | 88 |

Codes 61 (out of memory) and 63 (image pull failed) come from the pod's
status, and 70 to 79 from the import of the results.

An uploaded archive refused before any pod starts fails with one of these
codes, its message naming the limit or the entry:

| Code | Name | What happened |
|---|---|---|
| 90 | `ARCHIVE_TOO_LARGE` | The archive is over 5 GiB, or what is kept for the scanners is over 2 GiB as a ZIP. |
| 91 | `ARCHIVE_TOO_MANY_ENTRIES` | The archive holds more than 200,000 entries. |
| 92 | `ARCHIVE_ENTRY_TOO_LARGE` | One file is over 1 GiB unpacked. |
| 93 | `ARCHIVE_INFLATED_TOO_LARGE` | The archive is over 5 GiB unpacked, or what is kept for the scanners over 3 GiB. |
| 94 | `ARCHIVE_INVALID` | The file is not a ZIP archive (a `.tar.gz`, a renamed file) or cannot be read. |
| 95 | `ARCHIVE_EMPTY` | The ZIP holds no file. |
| 96 | `ARCHIVE_ENCRYPTED` | The archive is password-protected. |
| 97 | `ARCHIVE_UNSAFE_PATH` | An entry's path is absolute or leaves the archive's folder (`..`). |
| 98 | `ARCHIVE_NOT_RECEIVED` | No archive was uploaded within 30 minutes of the scan's start. |

The scan is refused before any upload, with `409 NO_SCANNER_ENABLED`, when
every scanner of the project (SAST, IaC, SCA, secrets) is turned off.

To read a pod's own log, keep the pods:

```bash
CYBEDEFEND_SCANNER_KEEP_PODS=true
```

Every pod and Secret the instance creates carries the label
`cybedefend.io/instance=<id>`, and the instance only ever lists or cleans up
its own. `<id>` is the first 16 hexadecimal characters of the SHA-256 of
`CYBEDEFEND_PUBLIC_URL`, written as the instance reads it: no surrounding
spaces, no trailing slash, the scheme and host in lower case
(`https://appsec.example.com`). On Linux:

```bash
CYBEDEFEND_PUBLIC_URL=https://appsec.example.com
CYBEDEFEND_INSTANCE_ID=$(printf '%s' "$CYBEDEFEND_PUBLIC_URL" | sha256sum | cut -c1-16)
```

On macOS:

```bash
CYBEDEFEND_INSTANCE_ID=$(printf '%s' "$CYBEDEFEND_PUBLIC_URL" | shasum -a 256 | cut -c1-16)
```

`security-scanning` prints the same id in its enable line,
`CLUSTER_SCANNING_ENABLED namespace=<namespace> instance=<id>`
(`docker compose logs security-scanning | grep CLUSTER_`): copy it from there instead of computing it.

Changing `CYBEDEFEND_PUBLIC_URL` while scans run changes the id, so the pods and
Secrets of those scans are no longer the instance's: delete them by hand, with
the former id.

Then, after `docker compose up -d` and another scan:

```bash
kubectl -n cybedefend-scans get pods -l app.kubernetes.io/managed-by=cybedefend,cybedefend.io/instance=$CYBEDEFEND_INSTANCE_ID
```

```bash
kubectl -n cybedefend-scans logs <pod name>
```

A kept pod's Secret still holds the archive URL until that URL expires. Turn
the setting off again when you are done, then delete what was kept. The command
below also deletes the pods and Secrets of the scans still running, which then
fail with code 87 (`CLUSTER_POD_LOST`): run it only once no scan is running.

```bash
kubectl -n cybedefend-scans delete pods,secrets -l app.kubernetes.io/managed-by=cybedefend,cybedefend.io/instance=$CYBEDEFEND_INSTANCE_ID
```

### A local cluster (OrbStack)

This runs the instance with `docker compose` and the scans on OrbStack's
Kubernetes, on the same Mac. The cluster's context is named `orbstack`.

Three addresses differ from a server install:

- In a scan pod, `localhost` is the pod. The pods reach the Mac's published
  ports at `host.docker.internal`, so the public URLs use that host.
- The Mac itself does not resolve `host.docker.internal`: you add it to
  `/etc/hosts`.
- Inside the `security-scanning` container, `127.0.0.1` is the container. The
  kubeconfig's `server` is `https://k8s.orb.local:26443`, not the
  `https://127.0.0.1:26443` of your own kubeconfig. The API server's
  certificate covers `k8s.orb.local`.

**Open the instance at `http://host.docker.internal:8080`, never at
`http://localhost:8080`.** The session cookie and the API's origin are bound
to `CYBEDEFEND_PUBLIC_URL`: on another address, sign-in loops.

You may have other contexts in your kubeconfig, a production cluster for
example. Every `kubectl` command below names `--context orbstack`: keep it, so
nothing is applied to the wrong cluster. Check the context exists:

```bash
kubectl config get-contexts orbstack
```

#### 1. Resolve host.docker.internal on the Mac

```bash
echo '127.0.0.1 host.docker.internal' | sudo tee -a /etc/hosts
```

#### 2. Point the public URLs at host.docker.internal

Set, in `.env`:

```bash
CYBEDEFEND_PUBLIC_URL=http://host.docker.internal:8080
CYBEDEFEND_STORAGE_PUBLIC_URL=http://host.docker.internal:9000
AUTH_COOKIE_INSECURE_LOCALHOST=true
```

The refresh cookie is `Secure` by default, and a browser refuses a `Secure`
cookie over HTTP anywhere but `localhost`. `AUTH_COOKIE_INSECURE_LOCALHOST=true`
drops the flag (see [HTTPS](#https)).

#### 3. Build the images

Until the images are published on `ghcr.io`, or to test your own build, build
them on the Mac. The instance, from this directory:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml build
```

The scanners, from a clone of the `cybedefend-scanners` repository. `make images`
tags them `cybedefend-scanners/<name>:dev`; tag them again with the name and
version the instance asks for, `ghcr.io/cybedefend/cybedefend-scanners/<name>:1.0.0`
(`1.0.0` is the default of `CYBEDEFEND_SCANNER_IMAGE_TAG`):

```bash
make images
for a in opengrep zizmor gitleaks trivy-config trivy-fs trivy-image; do docker tag "cybedefend-scanners/$a:dev" "ghcr.io/cybedefend/cybedefend-scanners/$a:1.0.0"; done
```

OrbStack's Kubernetes shares Docker's image store, and the scan pods use
`imagePullPolicy: IfNotPresent`: they run the local images, with no registry.

#### 4. Create the namespace and its ServiceAccount

Save the two files of
[1. Create the namespace and its ServiceAccount](#1-create-the-namespace-and-its-serviceaccount),
then apply them on OrbStack:

```bash
kubectl --context orbstack apply -f cybedefend-namespace.yaml
```

```bash
kubectl --context orbstack apply -f cybedefend-scanner.yaml
```

#### 5. Write the kubeconfig

This writes `cluster/kubeconfig` as
[2. Write the kubeconfig](#2-write-the-kubeconfig) describes: the CA and the
token of the ServiceAccount's Secret, and OrbStack's address for the
containers. Run it from this directory:

```bash
NS=cybedefend-scans
KC=cluster/kubeconfig
kubectl --context orbstack -n "$NS" get secret cybedefend-scanner-token -o jsonpath='{.data.ca\.crt}' | base64 -d > cluster/ca.crt
TOKEN=$(kubectl --context orbstack -n "$NS" get secret cybedefend-scanner-token -o jsonpath='{.data.token}' | base64 -d)
kubectl config --kubeconfig "$KC" set-cluster scans --server=https://k8s.orb.local:26443 --certificate-authority=cluster/ca.crt --embed-certs=true
kubectl config --kubeconfig "$KC" set-credentials cybedefend-scanner --token="$TOKEN"
kubectl config --kubeconfig "$KC" set-context cybedefend-scanner --cluster=scans --user=cybedefend-scanner
kubectl config --kubeconfig "$KC" use-context cybedefend-scanner
rm cluster/ca.crt
unset TOKEN
chmod 644 "$KC"
```

The services run as user 10001: instead of the `chown` and `chmod 400` of
step 2, `chmod 644` lets that user read the file. Do this on your own machine
only.

#### 6. Turn scanning on

Set, in `.env`, as in [3. Turn scanning on](#3-turn-scanning-on):

```bash
CYBEDEFEND_SCANNER_KUBECONFIG_FILE=/run/cybedefend-cluster/kubeconfig
CYBEDEFEND_SCANNER_NAMESPACE=cybedefend-scans
CYBEDEFEND_SCANNER_KEEP_PODS=true
```

`CYBEDEFEND_SCANNER_KEEP_PODS=true` keeps finished pods, to read their logs
(see [When a scanner fails](#when-a-scanner-fails)).

Then start, or recreate, the stack. `docker compose restart` does not read
`.env` again: after a change of `.env`, run `up -d` (with a service name to
recreate only that one).

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d
```

```bash
docker compose logs security-scanning | grep CLUSTER_
```

Wait for `CLUSTER_SCANNING_ENABLED`, then open
**`http://host.docker.internal:8080`** and start a scan.

Another local cluster works the same way, once its API server's address is
one the containers reach and its certificate covers that address.

#### When it does not work

- **The front answers 502.** The gateway is not up: `docker compose logs gateway`.
- **The gateway refuses to start because of `AUTH_COOKIE_INSECURE_LOCALHOST`.**
  The host of `CYBEDEFEND_PUBLIC_URL` is not `localhost`, `127.0.0.1` or
  `host.docker.internal`.
- **The sign-in page loops, and the gateway logs
  `[403] AUTH_ORIGIN_FORBIDDEN - /auth/refresh` every 15 seconds.** The browser
  opened the instance at another address than `CYBEDEFEND_PUBLIC_URL`, for
  example `http://localhost:8080` for a public URL on `host.docker.internal`.
  Refresh and logout accept only the instance's own origin. Open exactly the
  public URL.
- **`CLUSTER_SCANNING_UNREACHABLE_ADDRESS` in the log of `security-scanning`.**
  A public URL is still a loopback address (`localhost`): see step 2, then
  `up -d` again.
- **`CLUSTER_SCANNING_DISABLED reason=cluster_unreachable`.** The kubeconfig's
  `server` must be `https://k8s.orb.local:26443`: check it (step 5).
- **A pod fails with code 63 (image pull failed).** The scanner image is not
  in Docker's store under the name and tag the instance asks for: see step 3.

## The MCP server

The stack starts the MCP server for coding agents with every other service,
in `docker compose up -d`, and its session store, `mcp-redis`, with it.

To run the instance without it, remove both containers, if they run
(`docker compose rm -sf mcp mcp-redis`), then put both services in a profile
nothing starts, in a `docker-compose.override.yml` next to
`docker-compose.yml` (Docker Compose reads that file on its own):

```yaml
services:
  mcp:
    profiles: [disabled]
  mcp-redis:
    profiles: [disabled]
```

Delete the file and run `docker compose up -d` to start it again.

The MCP server listens on `CYBEDEFEND_MCP_PORT` (3010), on
`CYBEDEFEND_BIND_ADDRESS` (`127.0.0.1` by default), and answers at
`CYBEDEFEND_MCP_PUBLIC_URL` + `/mcp`. Agents authenticate with a personal access
token as bearer (`Authorization: Bearer cdp_…`).

## Upgrade

1. Set `CYBEDEFEND_VERSION` in `.env` to the new release, the value of the
   new `.env.example`. The compose file requires it: no image follows `latest`.
2. Optionally, verify the new images (see [Verify an image](#verify-an-image)).
3. Run:

   ```bash
   docker compose pull && docker compose up -d
   ```

The database migrations run when the services start, on PostgreSQL.
`postgres/init.sql` runs only on an empty `postgres-data` volume, so an upgrade
never re-creates a database.

### Upgrading from a version with the master key and `POSTGRES_PASSWORD` in `.env`

The master key is now a file, and the PostgreSQL superuser's password is
derived from it. Before `docker compose up -d`:

1. Write the key your instance runs with to the key file, readable by you
   alone, and check it is the same value as in `.env`:

   ```bash
   (umask 077 && grep '^CYBEDEFEND_SECRET_KEY=' .env | cut -d= -f2- | tr -d '\n' > secret-key)
   ```

2. Leave `CYBEDEFEND_SECRET_KEY` and `POSTGRES_PASSWORD` in `.env` for this
   first start, then run `docker compose pull && docker compose up -d`.
   - `init-secrets` reads the key file, checks that `CYBEDEFEND_SECRET_KEY`
     holds the same key (two different keys stop it, and nothing else
     starts), and warns that the variable is to be removed.
   - `postgres-roles` logs in as the superuser with `POSTGRES_PASSWORD` once,
     sets the derived password, and prints `the superuser now uses the
     password derived from the secret key: remove POSTGRES_PASSWORD from .env`
     (`docker compose logs postgres-roles`).
3. Remove `CYBEDEFEND_SECRET_KEY` and `POSTGRES_PASSWORD` from `.env`, and run
   `docker compose up -d` again: no value of `.env` holds a secret of the
   instance any more but the setup token and your integrations' credentials.

Without `POSTGRES_PASSWORD` on that first start, `postgres-roles` stops with
`the superuser cannot log in with the password derived from the secret key`
and the services do not start: put it back in `.env` and run
`docker compose up -d` again. A tool of yours that logged in as the superuser
with `POSTGRES_PASSWORD` needs its own role instead (see below), or
`docker compose exec postgres psql -U cybedefend`.

### Upgrading from a version where every service connected as `cybedefend`

Nothing to do by hand: `docker compose pull && docker compose up -d` is the
whole upgrade. Before any service starts, `init-secrets` writes the new
per-service files (and deletes the storage secret the earlier version kept in
the shared `runtime` volume), then `postgres-roles` creates the seven roles,
makes each the owner of its database and of every table, sequence, view, type
and function the superuser created in it, and closes each database to the
other roles. The services then connect as their own role. Your data, the
superuser is unchanged.

- Follow the section above too: the job logs in as the superuser with
  `POSTGRES_PASSWORD` once, to move it to the derived password.
- Check it ran: `docker compose logs postgres-roles` prints `role <database>
  ready` seven times. `docker compose exec postgres psql -U cybedefend -c '\l'`
  lists each database with its own role as owner.
- A tool of yours that connected as `cybedefend` keeps working (it is still
  the superuser). Give a new tool its own role rather than a service's.
- Going back to the earlier version needs no change in the database: its
  services connect as the superuser, which reaches every database whatever
  owns it. The next upgrade hands over what they created meanwhile.

## Verify an image

Each image of a release is signed with [cosign](https://docs.sigstore.dev/),
keyless: the signature names the workflow that built it, from the release tag,
in the public repository. Each image also carries a build provenance
attestation and an SBOM. To check an image before you run it:

```bash
cosign verify ghcr.io/cybedefend/cybedefend-gateway:1.0.0 \
  --certificate-identity-regexp '^https://github.com/CybeDefend/cybedefend/.github/workflows/images.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Replace `gateway` and `1.0.0` with each image and the version of `.env`. A
missing or foreign signature makes the command fail. To read the provenance
and the SBOM:

```bash
docker buildx imagetools inspect ghcr.io/cybedefend/cybedefend-gateway:1.0.0 --format '{{ json .Provenance }}'
docker buildx imagetools inspect ghcr.io/cybedefend/cybedefend-gateway:1.0.0 --format '{{ json .SBOM }}'
```

## Backup

Back up, together with the master key (`secret-key`), kept apart:

- the `postgres-data` volume, which holds every database. A consistent dump:

  ```bash
  docker compose exec -T postgres pg_dumpall -U cybedefend > cybedefend.sql
  ```

- the `storage-data` volume (reports, uploaded files).

Redis (`redis-data`) holds queues and caches only.

## Troubleshooting

```bash
docker compose ps                      # state and health of every container
docker compose logs -f gateway         # one service's logs
docker compose logs --since 10m        # everything, recently
```

- A container that restarts in a loop says why in its first log lines: a missing
  `CYBEDEFEND_SETUP_TOKEN`, or `EMAIL_FROM` missing while `EMAIL_HOST` is set.
  A missing or empty `secret-key`, a key shorter than 32 bytes, or a
  `CYBEDEFEND_SECRET_KEY` in `.env` that differs from the key file stops
  `init-secrets`, and nothing else starts: `docker compose logs init-secrets`.
  `bind source path does not exist: …/secret-key` at `docker compose up`: the
  key file is missing (see [The secret key](#the-secret-key)).
  `the superuser cannot log in with the password derived from the secret key`
  (`docker compose logs postgres-roles`): an instance installed by an earlier
  version, see
  [Upgrade](#upgrading-from-a-version-with-the-master-key-and-postgres_password-in-env).
  A database login refused (`password authentication failed for user
  "cybedefend_…"`): `docker compose logs postgres-roles`.
- Sign-in works on localhost but not on another address: the site is not served
  over HTTPS (see [HTTPS](#https)).
- A report or upload fails in the browser but the API answers: the browser
  cannot reach `CYBEDEFEND_STORAGE_PUBLIC_URL`.
- `bash deploy/community/smoke.sh --help` lists the options of the smoke test,
  which starts a throwaway stack and checks setup, sign-in, imports and reports.
- `node --test tests/*.mjs smoke/tests/*.mjs nginx/tests/*.mjs`, from
  `deploy/community`, runs the deployment's own tests. `tests/images.test.mjs`
  checks the analysis-reporting image named by `CYBEDEFEND_AR_IMAGE`, else the
  local `ghcr.io/cybedefend/cybedefend-analysis-reporting:latest` (skipped when that
  image is not on the machine): Chromium for the PDF reports, and no git, no
  closed-feature package, no pnpm. With `CI` set, `CYBEDEFEND_AR_IMAGE` is
  required.

## Known limits

- **Invitations without SMTP.** When no SMTP server is configured, the
  invitation link is shown to the administrator who sends the invitation,
  who passes it on. Whoever holds the link can accept the invitation and
  choose the account's password: the inviter, or anyone the link reaches,
  could open the invitee's account before the invitee does. This is by
  design for instances without e-mail: hand the link over through a channel
  you trust. With SMTP
  configured, the link goes to the invitee by e-mail only and the API does
  not return it.
- **No built-in key rotation.** Neither the sign-in signing keys nor
  `CYBEDEFEND_SECRET_KEY` have a rotation command yet. Every encryption key
  is derived from `CYBEDEFEND_SECRET_KEY` (see [The secret key](#the-secret-key)):
  replacing it on a running instance leaves the data encrypted with the
  former key unreadable.
