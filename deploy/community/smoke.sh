#!/usr/bin/env bash
# CybeDefend Community Edition: the smoke test of the compose stack.
#
#   bash deploy/community/smoke.sh                 # every variant, images built from source
#   bash deploy/community/smoke.sh --help          # the options of smoke/run.mjs
#
# Needs Docker Compose >= 2.24.4 and Node >= 22. Runs from any directory.
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$#" -eq 0 ]; then
  exec node "$dir/smoke/run.mjs" --variant all --build
fi
exec node "$dir/smoke/run.mjs" "$@"
