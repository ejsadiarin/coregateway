-- +goose Up
-- +goose StatementBegin

-- A user's timezone (ADR-0005): the IANA zone (e.g. Asia/Manila) the
-- internal token's tz claim carries and downstream background jobs look up.
-- NULL means the user hasn't set one, which reads as UTC. The API validates
-- the zone against the IANA database; the check only keeps out the two
-- values Go's time.LoadLocation accepts that mean nothing for a user.
ALTER TABLE coregateway.users
    ADD COLUMN timezone TEXT CHECK (timezone <> '' AND timezone <> 'Local');

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE coregateway.users DROP COLUMN IF EXISTS timezone;

-- +goose StatementEnd
