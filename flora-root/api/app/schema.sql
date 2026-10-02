CREATE TABLE IF NOT EXISTS root_signing_key (
  key_id       text PRIMARY KEY,
  private_pem  text NOT NULL,
  public_raw   text NOT NULL,               -- base64 Ed25519 public key
  active       boolean NOT NULL DEFAULT true,
  created_at   bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS root_tenant (
  tenant_id     text PRIMARY KEY,           -- one tenant = one hospital = one Canopy
  name          text NOT NULL,
  region        text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  api_key_hash  text NOT NULL,              -- Canopy authenticates with this key
  created_at    bigint NOT NULL,
  updated_at    bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS root_license (
  bundle_id            text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES root_tenant(tenant_id),
  modules              text[] NOT NULL,
  max_leaves           integer NOT NULL,
  max_gateways         integer NOT NULL,
  max_gateway_devices  integer NOT NULL,
  device_types         text[] NOT NULL DEFAULT '{}',
  issued_at            bigint NOT NULL,
  expires_at           bigint NOT NULL,
  revoked_at           bigint,
  current              boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS root_license_current ON root_license (tenant_id) WHERE current;

-- Applies to every tenant; delivered inside each signed bundle.
CREATE TABLE IF NOT EXISTS root_global_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS root_checkin (
  tenant_id       text PRIMARY KEY REFERENCES root_tenant(tenant_id),
  last_seen_at    bigint NOT NULL,
  canopy_version  text,
  bundle_id       text,
  usage           jsonb NOT NULL DEFAULT '{}'::jsonb
);
