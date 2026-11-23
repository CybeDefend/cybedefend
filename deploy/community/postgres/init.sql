-- CybeDefend Community Edition: the databases of the single PostgreSQL server.
--
-- The postgres image runs this file once, on an empty data volume, as its
-- bootstrap role cybedefend (POSTGRES_USER). Its password is derived from the
-- master key by init-secrets and read from POSTGRES_PASSWORD_FILE, so no
-- password appears here. Each service's own migrations create its tables and the
-- citext extension; this file creates the databases only. The postgres-roles
-- job (roles.sh, roles.sql) then hands each one to the service's own role.

CREATE DATABASE permify OWNER cybedefend;
CREATE DATABASE cybedefend_policy OWNER cybedefend;
CREATE DATABASE cybedefend_global_management OWNER cybedefend;
CREATE DATABASE cybedefend_scanning OWNER cybedefend;
CREATE DATABASE cybedefend_analysis_and_reporting OWNER cybedefend;
CREATE DATABASE cybedefend_file_management OWNER cybedefend;
CREATE DATABASE cybedefend_external_integrations OWNER cybedefend;
