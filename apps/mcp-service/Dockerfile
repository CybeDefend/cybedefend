# cybedefend-ignore[CD-IAC-0210]: Checkov reports on line 1 the HEALTHCHECK missing from the whole image; the health check is defined by the orchestrator, not the image: the Compose file declares the container's healthcheck, and a Kubernetes deployment uses its probes, which ignore Docker's HEALTHCHECK instruction
# Version-stripped deps manifest: strip the volatile `version` so a release bump no
# longer busts the pnpm install layer below. COPY --from is content-addressed, so it
# re-converges on the identical stripped output even after the version changed.
# cybedefend-ignore[CD-IAC-0210]: KICS <= 2.1 attaches to this first FROM the HEALTHCHECK missing from the final stage (same image); the health check is defined by the orchestrator, not the image: the Compose file declares the container's healthcheck, and a Kubernetes deployment uses its probes, which ignore Docker's HEALTHCHECK instruction
FROM node:26.13.1-alpine3.24 AS deps-manifest
WORKDIR /m
COPY apps/mcp-service/package.json apps/mcp-service/pnpm-lock.yaml ./
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json'));p.version='0.0.0';require('fs').writeFileSync('package.json',JSON.stringify(p))"

FROM node:26.13.1-alpine3.24 AS builder
WORKDIR /app

RUN addgroup -S -g 10001 appgroup && adduser -S -u 10001 -G appgroup appuser
RUN npm install -g pnpm@10.34.9

# Install protoc for ts-proto generation at build time
# cybedefend-ignore[CD-IAC-1967]: packages from the base image's own Alpine repository, which keeps one version of each; the base image pins the Alpine minor, and an exact version would break the build at its next security fix
RUN apk add --no-cache protobuf

# The image mirrors the repo with /app standing for apps/: the service sits at
# /app/<service> (its runtime path, unchanged) and reaches the libs at ../../libs,
# i.e. /libs, as `file:../../libs/<lib>` and `proto:generate` expect.
COPY libs/protos /libs/protos
# Deps layer from the version-stripped manifest (deps-manifest stage) so release
# version bumps no longer bust this install cache. The real package.json is restored
# by the full-source COPY below and is what ships in the final image.
COPY --from=deps-manifest /m/package.json /m/pnpm-lock.yaml ./mcp-service/
WORKDIR /app/mcp-service
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN pnpm install --frozen-lockfile
# Then the source — editing it no longer busts the install layer above.
WORKDIR /app
COPY apps/mcp-service ./mcp-service
WORKDIR /app/mcp-service
RUN pnpm run build

WORKDIR /app

# Production dependencies only, in a stage of their own: the running image takes
# node_modules from here, without pnpm, its store or the dev dependencies.
FROM node:26.13.1-alpine3.24 AS prod-deps
WORKDIR /app

RUN npm install -g pnpm@10.34.9

COPY --from=builder /app/mcp-service/package*.json ./mcp-service/
COPY --from=builder /app/mcp-service/pnpm-lock.yaml ./mcp-service/pnpm-lock.yaml
WORKDIR /app/mcp-service
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN pnpm install --prod --frozen-lockfile

# cybedefend-ignore[CD-IAC-0210]: The health check is defined by the orchestrator, not the image: the Compose file declares the container's healthcheck, and a Kubernetes deployment uses its probes, which ignore Docker's HEALTHCHECK instruction
FROM node:26.13.1-alpine3.24
WORKDIR /app

RUN addgroup -S -g 10001 appgroup && adduser -S -u 10001 -G appgroup appuser
# cybedefend-ignore[CD-IAC-1967]: packages from the base image's own Alpine repository, which keeps one version of each; the base image pins the Alpine minor, and an exact version would break the build at its next security fix
RUN apk add --no-cache ca-certificates openssl

# The base image ships npm and npx, which nothing here runs: the service starts
# with `node`. Uninstalled so the running image carries no package manager.
RUN npm uninstall -g npm

COPY --from=builder /app/mcp-service/package.json ./mcp-service/
COPY --from=prod-deps /app/mcp-service/node_modules ./mcp-service/node_modules

WORKDIR /app
# `dist` is copied AFTER the prod install, not before: it is the one input that
# changes on every single commit, and anything below a busted layer is busted
# too. With it above, a one-line source edit re-ran `pnpm install --prod` from
# scratch every build. The install only needs package.json + the lockfile.
COPY --from=builder /app/mcp-service/dist ./mcp-service/dist

# NOTE: no `chown -R appuser:appgroup /app`. Every file here is root-owned and
# world-readable (0644/0755), which is all appuser needs — it only reads `dist`
# and `node_modules`. A recursive chown touches an inode attribute on every file,
# which on overlayfs forces a copy-up of each one: it duplicates the whole
# node_modules tree into a layer carrying no new content, and is slow on a
# nested overlayfs. Root ownership is also the safer default — the app cannot
# rewrite its own code — and the container can run with a read-only root
# filesystem.

COPY apps/mcp-service/entrypoint.sh /scripts/entrypoint.sh
RUN chmod +x /scripts/entrypoint.sh

# Ship the proto definitions alongside the build — the gRPC listener in
# main.ts loads `/app/protos/mcp/mcp.proto` at runtime in production.
COPY libs/protos /app/protos

USER appuser
ENV NODE_ENV=production
EXPOSE 3010 50061

ENTRYPOINT ["/scripts/entrypoint.sh"]
