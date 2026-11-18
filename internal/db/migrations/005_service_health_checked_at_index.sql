-- +goose Up
-- Retention deletes by age, so the prune is an index range scan rather than
-- a table scan as history grows.
CREATE INDEX IF NOT EXISTS idx_service_health_checked_at
    ON coregateway.service_health_history (checked_at);

-- +goose Down
DROP INDEX IF EXISTS coregateway.idx_service_health_checked_at;
