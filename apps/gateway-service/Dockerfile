# cybedefend-ignore[CD-IAC-0210]: Checkov reports on line 1 the HEALTHCHECK missing from the whole image; the health check is defined by the orchestrator, not the image: the Compose file declares the container's healthcheck, and a Kubernetes deployment uses its probes, which ignore Docker's HEALTHCHECK instruction
# Version-stripped deps manifest: strip the volatile `version` so a release bump no
# longer busts the pnpm install layer below. COPY --from is content-addressed, so it
# re-converges on the identical stripped output even after the version changed.
# cybedefend-ignore[CD-IAC-0210]: KICS <= 2.1 attaches to this first FROM the HEALTHCHECK missing from the final stage (same image); the health check is defined by the orchestrator, not the image: the Compose file declares the container's healthcheck, and a Kubernetes deployment uses its probes, which ignore Docker's HEALTHCHECK instruction
FROM node:26.13.1-alpine3.24 AS deps-manifest
WORKDIR /m
COPY apps/gateway-service/package.json apps/gateway-service/pnpm-lock.yaml ./
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json'));p.version='0.0.0';require('fs').writeFileSync('package.json',JSON.stringify(p))"

FROM node:26.13.1-alpine3.24 AS builder
WORKDIR /app

# NOTE: GIT_COMMIT_HASH is deliberately NOT declared in this stage. It is read at
# runtime only (`process.env.GIT_COMMIT_HASH` in src/app.service.ts) — `tsc` does
# not inline it — so declaring it here bought nothing and cost everything: an
# in-scope ARG/ENV is part of the cache key of every layer below it, so a value
# that changes on every commit made `pnpm install` and `pnpm run build` miss the
# registry buildcache on every single build.
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
COPY --from=deps-manifest /m/package.json /m/pnpm-lock.yaml ./gateway-service/
WORKDIR /app/gateway-service
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN pnpm install --frozen-lockfile
# Then the source — editing it no longer busts the install layer above.
WORKDIR /app
COPY apps/gateway-service ./gateway-service
WORKDIR /app/gateway-service
RUN pnpm run build

# Reset workdir for clarity
WORKDIR /app

# Production dependencies only, in a stage of their own: the running image takes
# node_modules from here, without pnpm, its store or the dev dependencies.
FROM node:26.13.1-alpine3.24 AS prod-deps
WORKDIR /app

RUN npm install -g pnpm@10.34.9

COPY --from=builder /app/gateway-service/package*.json ./gateway-service/
# Copy lockfile if present for reproducible install
COPY apps/gateway-service/pnpm-lock.yaml ./gateway-service/pnpm-lock.yaml
# Install production deps from within the service directory
WORKDIR /app/gateway-service
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

COPY --from=builder /app/gateway-service/package.json ./gateway-service/
COPY --from=prod-deps /app/gateway-service/node_modules ./gateway-service/node_modules

# Back to /app for the remainder
WORKDIR /app

# `dist` is copied AFTER the prod install, not before: it is the one input that
# changes on every single commit, and anything below a busted layer is busted
# too. With it above, a one-line source edit re-ran `pnpm install --prod` from
# scratch every build. The install only needs package.json + the lockfile.
COPY --from=builder /app/gateway-service/dist ./gateway-service/dist

# NOTE: no `chown -R appuser:appgroup /app`. Every file here is root-owned and
# world-readable (0644/0755), which is all appuser needs — it only reads `dist`
# and `node_modules`. A recursive chown changes an inode attribute on every file,
# which on overlayfs forces a copy-up of each one: it duplicates the whole
# node_modules tree into a layer carrying no new content, and is slow on a
# nested overlayfs. Root ownership is also the safer default — the app cannot
# rewrite its own code — and the container can run with a read-only root
# filesystem.
COPY apps/gateway-service/entrypoint.sh /scripts/entrypoint.sh
RUN chmod +x /scripts/entrypoint.sh

COPY libs/protos /app/protos

USER appuser
ENV NODE_ENV=production
EXPOSE 3000

# Declared last, on purpose: this value changes on every commit, so anything
# below it in the file would never hit the build cache. Keep it after all
# COPY/RUN steps.
ARG GIT_COMMIT_HASH=unknown
ENV GIT_COMMIT_HASH=${GIT_COMMIT_HASH}

ENTRYPOINT ["/scripts/entrypoint.sh"]
