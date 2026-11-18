-- +goose Up
-- Built-in services are the gateway's own downstreams, seeded from config.
-- They can be paused and tuned, but not deleted or repointed.
ALTER TABLE coregateway.services
    ADD COLUMN is_builtin BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN builtin_key VARCHAR(50) UNIQUE;

ALTER TABLE coregateway.services
    ADD CONSTRAINT services_builtin_key_check
    CHECK (is_builtin = (builtin_key IS NOT NULL));

-- +goose Down
ALTER TABLE coregateway.services DROP CONSTRAINT IF EXISTS services_builtin_key_check;
ALTER TABLE coregateway.services DROP COLUMN IF EXISTS builtin_key;
ALTER TABLE coregateway.services DROP COLUMN IF EXISTS is_builtin;
