# cybedefend-ignore[CD-IAC-0210]: Checkov reports the image's missing HEALTHCHECK on line 1; the image runs only on Kubernetes, which ignores Docker's HEALTHCHECK instruction: container health is the chart's probes' job
# Version-stripped deps manifest: strip the volatile `version` so a release bump no
# longer busts the pnpm install layer below. COPY --from is content-addressed, so it
# re-converges on the identical stripped output even after the version changed.
# cybedefend-ignore[CD-IAC-0210]: KICS <= 2.1 attaches the final stage's missing HEALTHCHECK to this first FROM (same image); the image runs only on Kubernetes, which ignores Docker's HEALTHCHECK instruction: container health is the chart's probes' job
FROM node:26.13.1-alpine3.24 AS deps-manifest
WORKDIR /m
COPY apps/security-scanning-service/package.json apps/security-scanning-service/pnpm-lock.yaml ./
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json'));p.version='0.0.0';require('fs').writeFileSync('package.json',JSON.stringify(p))"

FROM node:26.13.1-alpine3.24 AS builder
WORKDIR /app

RUN addgroup -S -g 10001 appgroup && adduser -S -u 10001 -G appgroup appuser

# Enable pnpm via corepack (ships with Node.js >=16.13)
RUN npm install -g pnpm@10.34.9

# Install protoc for ts-proto generation at build time
# cybedefend-ignore[CD-IAC-1967]: packages from the base image's own Alpine repository, which keeps one version of each; the base image pins the Alpine minor, and an exact version would break the build at its next security fix
RUN apk add --no-cache protobuf

# The image mirrors the repo with /app standing for apps/: the service sits at
# /app/<service> (its runtime path, unchanged) and reaches the libs at ../../libs,
# i.e. /libs, as `file:../../libs/<lib>` and `proto:generate` expect.
COPY libs/protos /libs/protos

# Build shared lib (consumers reference it via file:../../libs/realtime-publisher).
# dist/ is gitignored, and pnpm does not run `prepare` for `file:` deps, so we
# build it explicitly before the service's install.
COPY libs/realtime-publisher /libs/realtime-publisher
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN cd /libs/realtime-publisher && pnpm install --frozen-lockfile && pnpm run build

# Same for db-dialect (consumers reference it via file:../../libs/db-dialect).
COPY libs/db-dialect /libs/db-dialect
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN cd /libs/db-dialect && pnpm install --frozen-lockfile && pnpm run build

# Deps layer from the version-stripped manifest (deps-manifest stage) so release
# version bumps no longer bust this install cache. The real package.json is restored
# by the full-source COPY below and is what ships in the final image.
COPY --from=deps-manifest /m/package.json /m/pnpm-lock.yaml ./security-scanning-service/
WORKDIR /app/security-scanning-service
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN pnpm install --frozen-lockfile
# Then the source — editing it no longer busts the install layer above.
WORKDIR /app
COPY apps/security-scanning-service ./security-scanning-service
WORKDIR /app/security-scanning-service
RUN pnpm run build

# Reset workdir for clarity
WORKDIR /app

# Production dependencies only, in a stage of their own: the running image takes
# node_modules from here, without pnpm, its store or the dev dependencies.
FROM node:26.13.1-alpine3.24 AS prod-deps
WORKDIR /app

RUN npm install -g pnpm@10.34.9

COPY --from=builder /libs/realtime-publisher/package.json /libs/realtime-publisher/package.json
# The shared lib's `dist` MUST already be on disk when `pnpm install --prod` runs.
# It is a `file:` dependency, so pnpm materialises it into node_modules at install
# time honouring its `files: ["dist"]` allowlist — copied afterwards, the install
# produces a node_modules copy with no dist/ and every consumer dies at require()
# with MODULE_NOT_FOUND. Unlike the service dist it changes only when the lib
# itself changes, so the prod-install layer still caches across service commits.
COPY --from=builder /libs/realtime-publisher/dist /libs/realtime-publisher/dist
COPY --from=builder /libs/db-dialect/package.json /libs/db-dialect/package.json
COPY --from=builder /libs/db-dialect/dist /libs/db-dialect/dist
COPY --from=builder /app/security-scanning-service/package*.json ./security-scanning-service/
# Copy lockfile if present for reproducible install
COPY apps/security-scanning-service/pnpm-lock.yaml ./security-scanning-service/pnpm-lock.yaml
# Install production deps from within the service directory
WORKDIR /app/security-scanning-service
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN pnpm install --prod --frozen-lockfile

# cybedefend-ignore[CD-IAC-0210]: the image runs only on Kubernetes, which ignores Docker's HEALTHCHECK instruction: container health is the chart's probes' job
FROM node:26.13.1-alpine3.24
WORKDIR /app

RUN addgroup -S -g 10001 appgroup && adduser -S -u 10001 -G appgroup appuser

# cybedefend-ignore[CD-IAC-1967]: packages from the base image's own Alpine repository, which keeps one version of each; the base image pins the Alpine minor, and an exact version would break the build at its next security fix
RUN apk add --no-cache ca-certificates openssl

# The base image ships npm and npx, which nothing here runs: the service starts
# with `node`. Uninstalled so the running image carries no package manager.
RUN npm uninstall -g npm

COPY --from=builder /libs/realtime-publisher/package.json /libs/realtime-publisher/package.json
COPY --from=builder /libs/realtime-publisher/dist /libs/realtime-publisher/dist
COPY --from=builder /libs/db-dialect/package.json /libs/db-dialect/package.json
COPY --from=builder /libs/db-dialect/dist /libs/db-dialect/dist
COPY --from=builder /app/security-scanning-service/package.json ./security-scanning-service/
COPY --from=prod-deps /app/security-scanning-service/node_modules ./security-scanning-service/node_modules

# Back to /app for the remainder
WORKDIR /app

# The SERVICE `dist` is copied AFTER the prod install, not before: it is the one
# input that changes on every single commit, and anything below a busted layer is
# busted too. With it above, a one-line source edit re-ran `pnpm install --prod`
# from scratch every build. The install only needs package.json + the lockfile.
COPY --from=builder /app/security-scanning-service/dist ./security-scanning-service/dist

# NOTE: no `chown -R appuser:appgroup /app`. Every file here is root-owned and
# world-readable (0644/0755), which is all appuser needs — it only reads `dist`
# and `node_modules`. A recursive chown touches an inode attribute on every file,
# which on overlayfs forces a copy-up of each one: it duplicates the whole
# node_modules tree into a large layer carrying no new content, and is slow on a
# nested overlayfs. Root ownership is also the safer default —
# the app cannot rewrite its own code — and the pods run with
# `readOnlyRootFilesystem: true`, so /app is not writable at runtime regardless.

COPY apps/security-scanning-service/entrypoint.sh /scripts/entrypoint.sh
RUN chmod +x /scripts/entrypoint.sh

COPY libs/protos /app/protos

USER appuser
ENV NODE_ENV=production
EXPOSE 50051

ENTRYPOINT ["/scripts/entrypoint.sh"]
