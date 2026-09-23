-- +goose Up
-- +goose StatementBegin

CREATE TABLE coregateway.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_prefix VARCHAR(32) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    label VARCHAR(255) NOT NULL,
    owner_user_id UUID,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    -- TIMESTAMPTZ (not TIMESTAMP): expiry is compared against time.Now()
    -- in Go, so stored values must be absolute instants immune to the
    -- session timezone. The older tables compare in-SQL (NOW()) and are
    -- unaffected by the wall-clock skew that TIMESTAMP would cause here.
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_keys_hash ON coregateway.api_keys(key_hash);
CREATE INDEX idx_api_keys_owner ON coregateway.api_keys(owner_user_id);
CREATE INDEX idx_api_keys_expires ON coregateway.api_keys(expires_at);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS coregateway.idx_api_keys_expires;
DROP INDEX IF EXISTS coregateway.idx_api_keys_owner;
DROP INDEX IF EXISTS coregateway.idx_api_keys_hash;

DROP TABLE IF EXISTS coregateway.api_keys;

-- +goose StatementEnd
