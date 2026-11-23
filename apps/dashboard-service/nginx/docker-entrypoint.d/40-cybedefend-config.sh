#!/bin/sh
# Writes the dashboard's runtime configuration (config.js) from the environment,
# at container start: the nginx image's /docker-entrypoint.sh runs every
# executable *.sh of /docker-entrypoint.d/ before nginx. The bundle reads it
# through src/config/runtimeConfig.ts, which checks every value again.
#
#   CYBEDEFEND_API_URL     the gateway, default /api (the compose's front proxies it)
#   CYBEDEFEND_PUBLIC_URL  the dashboard's public URL
#   GITHUB_APP_URL         the GitHub App installation URL
#   SLACK_CLIENT_ID        the Slack app's client id
#   JIRA_CLIENT_ID         the Jira app's client id
#
# An empty or unset value is left out, so the build's value applies. Every value
# is JSON-escaped by jq: a quote in a value cannot leave its string.
# CYBEDEFEND_HTML_DIR overrides the html root (tests only).
set -eu

html_dir="${CYBEDEFEND_HTML_DIR:-/usr/share/nginx/html}"

config_json=$(jq -n -c \
  --arg apiUrl "${CYBEDEFEND_API_URL:-/api}" \
  --arg publicUrl "${CYBEDEFEND_PUBLIC_URL:-}" \
  --arg githubAppUrl "${GITHUB_APP_URL:-}" \
  --arg slackClientId "${SLACK_CLIENT_ID:-}" \
  --arg jiraClientId "${JIRA_CLIENT_ID:-}" \
  '{apiUrl: $apiUrl, publicUrl: $publicUrl, githubAppUrl: $githubAppUrl,
    slackClientId: $slackClientId, jiraClientId: $jiraClientId}
   | with_entries(select(.value != ""))')

printf 'window.__CYBEDEFEND_CONFIG__ = %s;\n' "$config_json" > "${html_dir}/config.js"
echo "40-cybedefend-config: wrote ${html_dir}/config.js"
