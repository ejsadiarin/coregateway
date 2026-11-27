-- name: CreateService :one
INSERT INTO coregateway.services (
    name, url, icon, description, service_type,
    health_check_method, expected_status_codes, timeout
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
) RETURNING *;

-- name: GetService :one
SELECT * FROM coregateway.services
WHERE id = $1 LIMIT 1;

-- name: ListServices :many
SELECT * FROM coregateway.services
ORDER BY name;

-- name: UpdateService :one
UPDATE coregateway.services
SET 
    name = COALESCE(sqlc.narg('name'), name),
    url = COALESCE(sqlc.narg('url'), url),
    icon = COALESCE(sqlc.narg('icon'), icon),
    description = COALESCE(sqlc.narg('description'), description),
    service_type = COALESCE(sqlc.narg('service_type'), service_type),
    health_check_method = COALESCE(sqlc.narg('health_check_method'), health_check_method),
    expected_status_codes = COALESCE(sqlc.narg('expected_status_codes'), expected_status_codes),
    timeout = COALESCE(sqlc.narg('timeout'), timeout),
    is_active = COALESCE(sqlc.narg('is_active'), is_active),
    updated_at = NOW()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: DeleteService :exec
DELETE FROM coregateway.services
WHERE id = $1;

-- name: ListActiveServicesForHealthCheck :many
SELECT id, name, url, health_check_method, expected_status_codes, timeout
FROM coregateway.services
WHERE is_active = true;

-- name: UpsertBuiltinService :one
-- The config owns a built-in's URL and identity; its pause flag,
-- timeout and other tuning stay as the admin left them.
INSERT INTO coregateway.services (
    name, url, description, service_type, is_builtin, builtin_key
) VALUES (
    $1, $2, $3, $4, true, $5
)
ON CONFLICT (builtin_key) DO UPDATE SET
    url = EXCLUDED.url,
    description = EXCLUDED.description,
    service_type = EXCLUDED.service_type,
    updated_at = NOW()
RETURNING *;
