#!/bin/sh
set -e
cd /app/mcp-service
exec node dist/main
