-- CybeDefend Community Edition: moves the superuser to the password derived
-- from the master key.
--
-- Run by roles.sh, once, on an instance installed by an earlier version, as
-- the superuser logged in with its previous password (POSTGRES_PASSWORD):
--   psql -v verifier_file=<path> -f superuser.sql
--
-- The verifier (SCRAM-SHA-256$…), never the password: read from its file,
-- interpolated as a quoted literal, never printed. The server stores the
-- verifier as given, so the derived password opens the next session.

\set ON_ERROR_STOP on
\set verifier `cat :'verifier_file'`

ALTER ROLE CURRENT_USER WITH PASSWORD :'verifier';
\unset verifier
