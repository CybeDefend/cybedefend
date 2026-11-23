#!/bin/sh
# CybeDefend Community Edition: the PostgreSQL role of each service.
#
# Run by the one-shot job postgres-roles, after init-secrets, as the superuser
# of the bundled PostgreSQL (PGHOST, PGUSER from its environment). Its password
# is derived from the master key by init-secrets, which writes it to
# <dir>/superuser-password; it reaches psql through the environment of each
# psql process, never the container's configuration.
#
# An instance installed by an earlier version still has the superuser password
# that version took from POSTGRES_PASSWORD. When the derived password opens no
# session and POSTGRES_PREVIOUS_PASSWORD (the compose file passes .env's
# POSTGRES_PASSWORD) does, superuser.sql sets the derived password's verifier
# (<dir>/superuser.verifier) once; POSTGRES_PASSWORD can then leave .env.
#
# For each <database>.scram file the init-secrets job wrote in <dir>,
# roles.sql creates or updates the role <database> (login, no other right)
# with that SCRAM verifier, makes it the owner of the database of the same
# name (created when missing) and of every object in it, and closes that
# database to every other role. Idempotent: it runs at every start, on a new
# instance as on one where the superuser owned everything.
#
# Never prints a password or a verifier: psql reads each verifier from its file.

set -eu

dir="${1:?usage: roles.sh <dir of the init-secrets files for this job>}"
here="$(dirname "$0")"
sql="$here/roles.sql"
previous="${POSTGRES_PREVIOUS_PASSWORD:-}"
unset POSTGRES_PREVIOUS_PASSWORD PGPASSWORD

derived="$(cat "$dir/superuser-password")" && [ -n "$derived" ] || {
  echo "postgres-roles: $dir/superuser-password is missing or empty (did init-secrets run?)" >&2
  exit 1
}

# True when the password in $1 opens a session as the superuser.
logs_in() {
  PGPASSWORD="$1" psql -X -q -t -A -d postgres -c 'SELECT 1' >/dev/null 2>&1
}

if logs_in "$derived"; then
  if [ -n "$previous" ]; then
    echo "postgres-roles: the superuser already uses the password derived from the secret key: remove POSTGRES_PASSWORD from .env"
  fi
elif [ -n "$previous" ] && logs_in "$previous"; then
  PGPASSWORD="$previous" psql -X -q -v ON_ERROR_STOP=1 -d postgres \
    -v verifier_file="$dir/superuser.verifier" -f "$here/superuser.sql"
  logs_in "$derived" || {
    echo "postgres-roles: the superuser's new password does not open a session" >&2
    exit 1
  }
  echo "postgres-roles: the superuser now uses the password derived from the secret key: remove POSTGRES_PASSWORD from .env"
else
  echo "postgres-roles: the superuser cannot log in with the password derived from the secret key." >&2
  echo "An instance installed before this release keeps the superuser password it took from POSTGRES_PASSWORD:" >&2
  echo "set POSTGRES_PASSWORD in .env to that value for one start (docker compose up -d), then remove it." >&2
  exit 1
fi
previous=''

PGPASSWORD="$derived"
export PGPASSWORD
found=0
for file in "$dir"/*.scram; do
  [ -e "$file" ] || break
  role="$(basename "$file" .scram)"
  case "$role" in
    '' | *[!a-z0-9_]*)
      echo "postgres-roles: unexpected file $file" >&2
      exit 1
      ;;
  esac
  psql -X -q -v ON_ERROR_STOP=1 -d postgres -v role="$role" -v verifier_file="$file" -f "$sql"
  echo "role $role ready"
  found=$((found + 1))
done

if [ "$found" -eq 0 ]; then
  echo "postgres-roles: no role verifier in $dir (did init-secrets run?)" >&2
  exit 1
fi
