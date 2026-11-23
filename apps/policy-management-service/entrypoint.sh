#!/bin/sh
set -e
cd /app/policy-management-service

MODE="${APP_MODE:-server}"

case "$MODE" in
  server|main)
    echo "Starting gRPC server..."
    exec node dist/main
    ;;
  worker)
    echo "Starting BullMQ worker (processing policy evaluation queue)..."
    exec node dist/worker
    ;;
  *)
    echo "Unknown APP_MODE: $MODE" >&2
    echo "Expected: server|main|worker" >&2
    exit 1
    ;;
esac
