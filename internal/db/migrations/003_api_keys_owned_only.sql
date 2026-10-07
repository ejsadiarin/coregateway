-- +goose Up
-- +goose StatementBegin

-- Retire ownerless (service) keys: sync service-to-service exchange is
-- removed, keys are always owned. Revoke then delete so no ownerless row
-- survives, then enforce at the DDL level.
UPDATE coregateway.api_keys
SET revoked_at = NOW(), updated_at = NOW()
WHERE owner_user_id IS NULL AND revoked_at IS NULL;

DELETE FROM coregateway.api_keys WHERE owner_user_id IS NULL;

ALTER TABLE coregateway.api_keys ALTER COLUMN owner_user_id SET NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE coregateway.api_keys ALTER COLUMN owner_user_id DROP NOT NULL;

-- +goose StatementEnd
