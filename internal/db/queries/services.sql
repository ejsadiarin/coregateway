-- name: CreateService :one
INSERT INTO coregateway.services (
    name, url, icon, description, service_type,
    health_check_interval, health_check_method,
    expected_status_codes, timeout
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
) RETURNING *;

-- name: GetService :one
SELECT * FROM coregateway.services
WHERE id = $1 LIMIT 1;

-- name: ListServices :many
SELECT 
    s.*,
    COALESCE(h.status, 'unknown') as current_status,
    h.checked_at as last_check,
    h.response_time
FROM coregateway.services s
LEFT JOIN LATERAL (
    SELECT status, checked_at, response_time
    FROM coregateway.service_health_history
    WHERE service_id = s.id
    ORDER BY checked_at DESC
    LIMIT 1
) h ON true
WHERE s.is_active = true
ORDER BY s.name;

-- name: UpdateService :one
UPDATE coregateway.services
SET 
    name = COALESCE(sqlc.narg('name'), name),
    url = COALESCE(sqlc.narg('url'), url),
    icon = COALESCE(sqlc.narg('icon'), icon),
    description = COALESCE(sqlc.narg('description'), description),
    service_type = COALESCE(sqlc.narg('service_type'), service_type),
    health_check_interval = COALESCE(sqlc.narg('health_check_interval'), health_check_interval),
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
SELECT id, name, url, health_check_method, expected_status_codes, timeout, health_check_interval
FROM coregateway.services
WHERE is_active = true;

-- name: UpsertBuiltinService :one
-- The config owns a built-in's URL and identity; its pause flag, interval,
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

-- name: DeleteOldHealthHistory :execrows
DELETE FROM coregateway.service_health_history
WHERE checked_at < sqlc.arg(checked_before);

-- name: CreateHealthHistory :one
INSERT INTO coregateway.service_health_history (
    service_id, status, response_time, status_code, error_message
) VALUES (
    $1, $2, $3, $4, $5
) RETURNING *;

-- name: GetServiceHistory :many
SELECT * FROM coregateway.service_health_history
WHERE service_id = $1
ORDER BY checked_at DESC
LIMIT $2;

-- name: GetServiceStats24h :one
SELECT 
    COUNT(*) as total_checks,
    COUNT(CASE WHEN status = 'online' THEN 1 END) as successful_checks,
    COALESCE(AVG(CASE WHEN response_time IS NOT NULL THEN response_time ELSE 0 END), 0) as avg_response_time
FROM coregateway.service_health_history
WHERE service_id = $1 AND checked_at >= NOW() - INTERVAL '24 hours';

-- name: GetServiceStats7d :one
SELECT 
    COUNT(*) as total_checks,
    COUNT(CASE WHEN status = 'online' THEN 1 END) as successful_checks
FROM coregateway.service_health_history
WHERE service_id = $1 AND checked_at >= NOW() - INTERVAL '7 days';

-- name: GetServiceStats30d :one
SELECT 
    COUNT(*) as total_checks,
    COUNT(CASE WHEN status = 'online' THEN 1 END) as successful_checks
FROM coregateway.service_health_history
WHERE service_id = $1 AND checked_at >= NOW() - INTERVAL '30 days';

-- name: GetAllServicesStats :one
SELECT 
    COUNT(DISTINCT service_id) as total_services,
    COUNT(*) as total_checks,
    COUNT(CASE WHEN status = 'online' THEN 1 END) as successful_checks,
    COALESCE(AVG(CASE WHEN response_time IS NOT NULL THEN response_time ELSE 0 END), 0) as avg_response_time
FROM coregateway.service_health_history
WHERE checked_at >= NOW() - INTERVAL '24 hours';
