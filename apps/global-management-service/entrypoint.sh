#!/bin/sh
set -e

cd /app/global-management-service

# The service by default; the CronJobs of the chart set APP_MODE to pick
# their one-shot entrypoint (charts/cybedefend/templates/cronjob.yaml).
MODE="${APP_MODE:-server}"

case "$MODE" in
  server|main)
    exec node dist/main
    ;;
  cron-data-purge)
    exec node dist/main.cron-data-purge
    ;;
  *)
    echo "Unknown APP_MODE: $MODE" >&2
    echo "Expected: server|main|cron-data-purge" >&2
    exit 1
    ;;
esac
