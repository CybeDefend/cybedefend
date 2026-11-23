# Community Edition image of the dashboard (ghcr.io/cybedefend/cybedefend-dashboard).
# Build context: apps/dashboard-service/. No cloud default: the API address, the
# public URL and the integration ids are read at container start from the
# environment (nginx/docker-entrypoint.d/40-cybedefend-config.sh writes
# config.js), so one image serves any deployment.

# -----------------------------------
# Stage 1: build
# -----------------------------------
FROM node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /app

RUN npm install -g pnpm@10.34.9

COPY package.json pnpm-lock.yaml ./
# pnpm applies patches/ during the install (pnpm.patchedDependencies).
COPY patches ./patches
# cybedefend-ignore[CD-IAC-3147]: pnpm installs exactly the versions of the committed pnpm-lock.yaml (--frozen-lockfile fails on any drift); the scanner reads the options as unpinned package names
RUN pnpm install --frozen-lockfile

COPY . .
ARG VITE_EDITION=community
# Relative: the gateway is served under /api on the dashboard's own origin.
ARG VITE_GATEWAY_URL=/api
ENV VITE_EDITION=$VITE_EDITION
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL

RUN VITE_EDITION=$VITE_EDITION VITE_GATEWAY_URL=$VITE_GATEWAY_URL pnpm run build

# -----------------------------------
# Stage 2: nginx
# -----------------------------------
FROM nginx:1.31.9-alpine3.24@sha256:0713660ff64e819a478be0d69ae314e52d21623c93672edd9f381a6e66fd95ff

# jq JSON-escapes the values the config entrypoint writes.
# cybedefend-ignore[CD-IAC-1967]: packages from the base image's own Alpine repository, which keeps one version of each; the base image pins the Alpine minor, and an exact version would break the build at its next security fix
RUN apk add --no-cache jq

RUN addgroup -S nginxgroup && adduser -S nginxuser -G nginxgroup

# /tmp/conf.d: where the compose's NGINX_ENVSUBST_OUTPUT_DIR has the nginx
# image render its templates; the envsubst step renders nothing into a
# directory that is missing or not writable by the runtime user.
RUN mkdir -p /var/cache/nginx /var/run /tmp/conf.d \
    && chown -R nginxuser:nginxgroup /var/cache/nginx /var/run /tmp/conf.d

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/community.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0755 nginx/docker-entrypoint.d/40-cybedefend-config.sh /docker-entrypoint.d/40-cybedefend-config.sh

# The runtime user rewrites config.js at start, and nothing else of the html root.
RUN chown nginxuser:nginxgroup /usr/share/nginx/html/config.js

USER nginxuser

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --spider http://localhost:8080 || exit 1

CMD ["nginx", "-g", "daemon off;"]
