# cybedefend-ignore[CD-IAC-0210]: Checkov reports on line 1 the HEALTHCHECK missing from the whole image; the Community compose file watches the container with its own healthcheck
#
# The Community Edition image of analysis-reporting. The export writes this file
# in place of apps/analysis-reporting-service/Dockerfile; the cloud image keeps
# building from the private one. It differs in what it leaves out:
#   - git: only the closed SCA AutoFix clones a repository;
#   - the GitHub Packages token: the exported package.json has no private package;
#   - puppeteer's own Chrome and chrome-headless-shell (640 MB): the PDF reports
#     run the Alpine chromium (PUPPETEER_EXECUTABLE_PATH), so nothing downloads them;
#   - pnpm and its content store (287 MB, a second copy of node_modules): the
#     production dependencies are installed in their own stage and only their
#     node_modules is copied into the image.
# Checked by apps/analysis-reporting-service/scripts/tests/community-image.bats (the
# private repository) and deploy/community/tests/images.test.mjs (the built image).
#
# The base image names an explicit Alpine minor, as the cloud Dockerfile does,
# so the `apk add` lines below install the same package set on every rebuild.
#
# Version-stripped deps manifest: strip the volatile `version` so a release bump
# does not bust the pnpm install layers below.
# cybedefend-ignore[CD-IAC-0210]: KICS <= 2.1 attaches to this first FROM the HEALTHCHECK missing from the final stage (same image); the Community compose file watches the container with its own healthcheck
FROM node:26.13.1-alpine3.24 AS deps-manifest
WORKDIR /m
COPY apps/analysis-reporting-service/package.json apps/analysis-reporting-service/pnpm-lock.yaml ./
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json'));p.version='0.0.0';require('fs').writeFileSync('package.json',JSON.stringify(p))"

FROM node:26.13.1-alpine3.24 AS builder
WORKDIR /app

# Puppeteer's postinstall would download its own browsers into /root/.cache:
# set before every pnpm install of this stage, the shared libs' included.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Node 26 dropped the bundled corepack, so pnpm is installed from npm instead.
RUN npm install -g pnpm@10.34.9

# Install protoc for ts-proto generation at build time
# cybedefend-ignore[CD-IAC-1967]: packages from the base image's own Alpine repository, which keeps one version of each; the base image pins the Alpine minor, and an exact version would break the build at its next security fix
RUN apk add --no-cache protobuf

COPY libs/protos /libs/protos

# Build the shared libs (the service references them via file:../../libs/<lib>).
# dist/ is not in the tree, and pnpm does not run `prepare` for `file:` deps.
COPY libs/realtime-publisher /libs/realtime-publisher
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN cd /libs/realtime-publisher && pnpm install --frozen-lockfile && pnpm run build

COPY libs/db-dialect /libs/db-dialect
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN cd /libs/db-dialect && pnpm install --frozen-lockfile && pnpm run build

COPY --from=deps-manifest /m/package.json /m/pnpm-lock.yaml ./analysis-reporting-service/
WORKDIR /app/analysis-reporting-service
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN pnpm install --frozen-lockfile

WORKDIR /app
COPY apps/analysis-reporting-service ./analysis-reporting-service
WORKDIR /app/analysis-reporting-service
RUN pnpm run build

# Production dependencies only, in a stage of their own: the running image takes
# node_modules from here, without pnpm, its store or the dev dependencies.
FROM node:26.13.1-alpine3.24 AS prod-deps
WORKDIR /app

RUN npm install -g pnpm@10.34.9

ENV PUPPETEER_SKIP_DOWNLOAD=true

# The shared libs' `dist` MUST already be on disk when `pnpm install --prod` runs:
# pnpm materialises a `file:` dependency into node_modules at install time,
# honouring its `files: ["dist"]` allowlist.
COPY --from=builder /libs/realtime-publisher/package.json /libs/realtime-publisher/package.json
COPY --from=builder /libs/realtime-publisher/dist /libs/realtime-publisher/dist
COPY --from=builder /libs/db-dialect/package.json /libs/db-dialect/package.json
COPY --from=builder /libs/db-dialect/dist /libs/db-dialect/dist
COPY --from=deps-manifest /m/package.json /m/pnpm-lock.yaml ./analysis-reporting-service/
WORKDIR /app/analysis-reporting-service
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN pnpm install --prod --frozen-lockfile --store-dir /tmp/pnpm-store

# cybedefend-ignore[CD-IAC-0210]: the Community compose file watches the container with its own healthcheck; a Docker HEALTHCHECK would duplicate it
FROM node:26.13.1-alpine3.24
WORKDIR /app

RUN addgroup -S -g 10001 appgroup && adduser -S -u 10001 -G appgroup appuser

# Chromium and its fonts for the PDF reports (Puppeteer).
# cybedefend-ignore[CD-IAC-1967]: packages from the base image's own Alpine repository, which keeps one version of each; the base image pins the Alpine minor, and an exact version would break the build at its next security fix
RUN apk add --no-cache \
    ca-certificates \
    openssl \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont \
    font-noto-emoji

# The base image ships npm and npx, which nothing here runs: the service starts
# with `node`. Uninstalled so the running image carries no package manager.
RUN npm uninstall -g npm

COPY --from=builder /libs/realtime-publisher/package.json /libs/realtime-publisher/package.json
COPY --from=builder /libs/realtime-publisher/dist /libs/realtime-publisher/dist
COPY --from=builder /libs/db-dialect/package.json /libs/db-dialect/package.json
COPY --from=builder /libs/db-dialect/dist /libs/db-dialect/dist
COPY --from=builder /app/analysis-reporting-service/package.json ./analysis-reporting-service/
COPY --from=prod-deps /app/analysis-reporting-service/node_modules ./analysis-reporting-service/node_modules

# The service `dist` last: it changes on every commit.
COPY --from=builder /app/analysis-reporting-service/dist ./analysis-reporting-service/dist

# No `chown -R`: every file is root-owned and world-readable, which is all
# appuser needs, and a recursive chown would copy every file into a new layer.

COPY apps/analysis-reporting-service/entrypoint.sh /scripts/entrypoint.sh
RUN chmod +x /scripts/entrypoint.sh

COPY libs/protos /app/protos

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_DEVEL_SANDBOX=/usr/lib/chromium/chrome-sandbox \
    XDG_CONFIG_HOME=/tmp/.chromium \
    XDG_CACHE_HOME=/tmp/.chromium

USER appuser
ENV NODE_ENV=production
EXPOSE 50051

ENTRYPOINT ["/scripts/entrypoint.sh"]
