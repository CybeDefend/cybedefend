#!/bin/sh
set -e
cd /app/analysis-reporting-service

# Create Chromium cache directory in /tmp (mounted as emptyDir in K8s)
mkdir -p /tmp/.chromium
chmod 700 /tmp/.chromium

MODE="${APP_MODE:-server}"

case "$MODE" in
  server|main)
    echo "Starting gRPC server..."
    exec node dist/main
    ;;
  worker)
    echo "Starting BullMQ worker (processing scan queues)..."
    exec node dist/worker
    ;;
  worker-reports)
    echo "Starting Reports worker (premium + aggregated report generation)..."
    exec node dist/worker-reports
    ;;
  cron-report-mail|main.cron-report-mail)
    echo "Starting Report Mail cron..."
    exec node dist/main.cron-report-mail
    ;;
  cron-report-retention|main.cron-report-retention)
    echo "Starting Report Retention purge cron..."
    exec node dist/main.cron-report-retention
    ;;
  *)
    echo "Unknown APP_MODE: $MODE" >&2
    echo "Expected: server|main|worker|worker-reports|cron-report-mail|cron-report-retention" >&2
    exit 1
    ;;
esac
