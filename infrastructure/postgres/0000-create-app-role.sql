\set app_password `echo "$FLORA_DB_APP_PASSWORD"`

SELECT format('CREATE ROLE flora_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flora_app')\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO flora_app', current_database())\gexec
GRANT USAGE, CREATE ON SCHEMA public TO flora_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flora_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO flora_app;
