-- API keys (gateway-owned credentials for programmatic and service callers)

-- name: CreateApiKey :one
INSERT INTO coregateway.api_keys (
    key_prefix, key_hash, label, owner_user_id, scopes, expires_at
) VALUES (
    $1, $2, $3, $4, $5, $6
)
RETURNING *;

-- name: GetApiKeyByHash :one
SELECT * FROM coregateway.api_keys
WHERE key_hash = $1 LIMIT 1;

-- name: ListApiKeys :many
SELECT id, key_prefix, label, owner_user_id, scopes, expires_at,
    revoked_at, last_used_at, created_at, updated_at
FROM coregateway.api_keys
ORDER BY created_at DESC;

-- name: RevokeApiKey :execrows
UPDATE coregateway.api_keys
SET revoked_at = NOW(), updated_at = NOW()
WHERE id = $1 AND revoked_at IS NULL;

-- name: TouchApiKeyLastUsed :exec
UPDATE coregateway.api_keys
SET last_used_at = NOW()
WHERE id = $1;
