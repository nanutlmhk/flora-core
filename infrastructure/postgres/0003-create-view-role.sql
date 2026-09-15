\set view_password `echo "$FLORA_DB_VIEW_PASSWORD"`

SELECT format('CREATE ROLE flora_view LOGIN PASSWORD %L', :'view_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flora_view')\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO flora_view', current_database())\gexec
GRANT USAGE ON SCHEMA public TO flora_view;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO flora_view;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO flora_view;
