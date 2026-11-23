#!/bin/sh
set -e

cd /app/external-integrations-service

MODE="${APP_MODE:-server}"

case "$MODE" in
  server|main)
    exec node dist/main
    ;;
  cron-webhook|main.cron-webhook)
    exec node dist/main.cron
    ;;
  worker)
    exec node dist/main.worker
    ;;
  *)
    echo "Unknown APP_MODE: $MODE" >&2
    echo "Expected: server|main|cron-webhook|worker" >&2
    exit 1
    ;;
esac
