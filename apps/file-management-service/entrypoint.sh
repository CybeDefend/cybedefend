#!/bin/sh
set -e
cd /app/file-management-service

MODE="${APP_MODE:-server}"

if [ "$MODE" = "cron" ]; then
  exec node dist/main.cron
else
  exec node dist/main
fi
