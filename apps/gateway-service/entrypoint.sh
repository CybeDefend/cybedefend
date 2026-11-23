#!/bin/sh
set -e

cd /app/gateway-service
exec node --require ./dist/instrumentation.js dist/main
