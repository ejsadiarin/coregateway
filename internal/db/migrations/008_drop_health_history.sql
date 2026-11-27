-- Health checks are kept in the gateway's memory, not the database (#74):
-- writing a row per check, and the per-service schedule that read the
-- services table every second, kept Neon from ever scaling to zero. Every
-- service is checked on one shared round, so the per-service interval goes too.
--
-- Deploy the gateway that no longer reads these first, then migrate: the old
-- binary breaks once they are gone.

-- +goose Up
-- +goose StatementBegin
DROP TABLE IF EXISTS coregateway.service_health_history;
ALTER TABLE coregateway.services DROP COLUMN IF EXISTS health_check_interval;
-- +goose StatementEnd

-- +goose Down
-- The history itself is not restored.
-- +goose StatementBegin
ALTER TABLE coregateway.services ADD COLUMN IF NOT EXISTS health_check_interval INTEGER DEFAULT 60;

CREATE TABLE IF NOT EXISTS coregateway.service_health_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID REFERENCES coregateway.services(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,
    response_time INTEGER,
    status_code INTEGER,
    error_message TEXT,
    checked_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_health_service_id ON coregateway.service_health_history (service_id);
CREATE INDEX IF NOT EXISTS idx_service_health_checked_at ON coregateway.service_health_history (checked_at);
-- +goose StatementEnd
