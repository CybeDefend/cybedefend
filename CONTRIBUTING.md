# Contributing to CybeDefend AppSec

Thank you for helping. This guide says how to build the code, what belongs to
the Community Edition, and how a pull request reaches a release.

## Set-up

You need:

- Node 24 (see `.nvmrc`);
- pnpm 10.34.9 (`corepack enable` picks it up from `package.json`);
- `protoc`, the Protocol Buffers compiler;
- Docker with `docker compose`, to run the dependencies from `deploy/community`.

Every service lives under `apps/`, and each is its own pnpm package; the
shared libraries are under `libs/`. The services depend on two of them as
local packages that ship only their compiled `dist`, so build these first,
from the repository root:

```bash
(cd libs/realtime-publisher && pnpm install && pnpm run build)
(cd libs/db-dialect && pnpm install && pnpm run build)
```

After you change a library, build it again and run `pnpm install` again in
each service that uses it: the service holds a copy of the library, not a link.

For a backend service (`gateway-service`,
`global-management-service`, `security-scanning-service`,
`analysis-reporting-service`, `file-management-service`,
`external-integrations-service`, `policy-management-service`,
`mcp-service`), run from its directory, `apps/<service>`:

```bash
pnpm install
pnpm run proto:generate
pnpm build
pnpm exec jest --ci --runInBand
```

The gRPC code under `src/core/grpc/` is generated from `libs/protos/` and is
never committed.

For the dashboard, from `apps/dashboard-service`:

```bash
pnpm install
pnpm build
pnpm exec vitest run
```

To run the whole stack locally, follow [deploy/community/README.md](deploy/community/README.md).

## What belongs to the Community Edition

We decide case by case, on the value to self-hosting teams, on what a feature
costs us to run, and on who buys it.

- **Community:** what one team needs to find, triage and fix findings from any
  scanner. For example: SARIF mapping fixes, a new issue tracker or code host
  integration, a report format, a policy rule type, dashboard usability,
  translations, documentation.
- **Paid:** what a security or compliance buyer pays for, or what costs us to
  run. For example: AI analysis, autofix and chat, the code map, the rule
  catalogue, SSO, SAML, SCIM and MFA, licence management, the agent guardrails
  product.
- **When unsure:** open an issue before writing code. A maintainer answers
  whether it fits.

## Licence

The Community Edition is open source under the GNU Affero General Public
License v3 (AGPL-3.0-only, see [LICENSE](LICENSE)). Your contribution is
published here under that licence.

## The Contributor License Agreement

Every contribution needs a signed CLA. It also lets CybeDefend SAS ship your
contribution under other terms, in its Cloud and Enterprise editions. CLA Assistant asks you to sign it on
your first pull request; you sign once. Read it in [CLA.md](CLA.md).

## How a pull request travels

This repository is published from a private repository, so an accepted pull
request is not merged here directly:

1. It is reviewed here.
2. Once accepted, a maintainer imports it into the private repository, keeping
   you as its author.
3. The next sync publishes it in a `Sync …` commit.
4. A maintainer comments with that commit and closes the pull request.

Some files are generated from private overlays at publication, and a pull
request cannot change them. If one of them needs a change, ask in an issue.

## Security

Never report a vulnerability in a public issue or pull request: see
[SECURITY.md](SECURITY.md).
