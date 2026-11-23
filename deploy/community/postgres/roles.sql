-- CybeDefend Community Edition: one service's PostgreSQL role.
--
-- Run by roles.sh as the superuser, once per role, connected to the database
-- postgres:  psql -v role=<database> -v verifier_file=<path> -f roles.sql
--
-- The role is named after its database. It may log in and nothing else (no
-- superuser, no CREATEROLE, no CREATEDB); it owns its database and every
-- object in it, so the service's migrations run as that role. Every other
-- role, but the superuser, is refused at the door of that database.
--
-- Idempotent. The bootstrap superuser cannot be the source of REASSIGN OWNED,
-- so the objects an earlier version created as the superuser are given to
-- the role one by one. Extension members stay with their extension.

\set ON_ERROR_STOP on
-- The verifier (SCRAM-SHA-256$…), never the password: read from its file,
-- interpolated as a quoted literal, never printed.
\set verifier `cat :'verifier_file'`

SELECT format('CREATE ROLE %I', :'role')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'role') \gexec

ALTER ROLE :"role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD :'verifier';
\unset verifier

SELECT format('CREATE DATABASE %I OWNER %I', :'role', :'role')
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'role') \gexec

ALTER DATABASE :"role" OWNER TO :"role";
REVOKE ALL ON DATABASE :"role" FROM PUBLIC;
-- No service connects to the maintenance databases either.
REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE template1 FROM PUBLIC;

\connect :"role"
SET cybedefend.target_role TO :'role';

DO $$
DECLARE
  target text := current_setting('cybedefend.target_role');
  former oid := (SELECT oid FROM pg_roles WHERE rolname = current_user);
  r record;
BEGIN
  -- Schemas (public belongs to pg_database_owner, i.e. to the role already).
  FOR r IN
    SELECT n.nspname
      FROM pg_namespace n
     WHERE n.nspowner = former AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
       AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_namespace'::regclass AND d.objid = n.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', r.nspname, target);
  END LOOP;

  -- Tables, views, materialized views, foreign tables. A table takes its
  -- indexes and the sequences its columns own along.
  FOR r IN
    SELECT c.oid::regclass AS rel, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relowner = former AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
       AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
      r.rel, target);
  END LOOP;

  -- Sequences no column owns.
  FOR r IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relowner = former AND c.relkind = 'S'
       AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
       AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i', 'e'))
  LOOP
    EXECUTE format('ALTER SEQUENCE %s OWNER TO %I', r.rel, target);
  END LOOP;

  -- Enums, domains, ranges and standalone composite types (an array type
  -- follows its element, a table's row type its table).
  FOR r IN
    SELECT t.oid::regtype AS typ, t.typtype
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typowner = former
       AND (t.typtype IN ('e', 'd', 'r') OR (t.typtype = 'c' AND (SELECT c.relkind FROM pg_class c WHERE c.oid = t.typrelid) = 'c'))
       AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
       AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I', CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, r.typ, target);
  END LOOP;

  -- Functions, procedures and aggregates.
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proowner = former
       AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
       AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO %I', r.fn, target);
  END LOOP;
END
$$;
