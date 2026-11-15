-- Users

-- name: CreateUser :one
INSERT INTO coregateway.users (
    email, password_hash, role
) VALUES (
    $1, $2, $3
)
RETURNING *;

-- name: GetUser :one
SELECT * FROM coregateway.users
WHERE id = $1 LIMIT 1;

-- name: GetUserByEmail :one
SELECT * FROM coregateway.users
WHERE email = $1 LIMIT 1;

-- name: ListUsers :many
SELECT * FROM coregateway.users
ORDER BY created_at DESC;

-- name: UpdateUser :one
UPDATE coregateway.users
SET
    email = COALESCE(sqlc.narg('email'), email),
    password_hash = COALESCE(sqlc.narg('password_hash'), password_hash),
    role = COALESCE(sqlc.narg('role'), role),
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: SetUserTimezone :one
UPDATE coregateway.users
SET timezone = $2, updated_at = NOW()
WHERE id = $1
RETURNING timezone;

-- name: DeleteUser :exec
DELETE FROM coregateway.users
WHERE id = $1;

-- name: CountAdmins :one
SELECT COUNT(*) FROM coregateway.users WHERE role = 'admin';

-- Sessions

-- name: CreateSession :one
INSERT INTO coregateway.sessions (
    user_id, token_hash, expires_at
) VALUES (
    $1, $2, $3
)
RETURNING *;

-- name: GetSessionByTokenHash :one
SELECT s.*, u.email, u.role
FROM coregateway.sessions s
JOIN coregateway.users u ON s.user_id = u.id
WHERE s.token_hash = $1 AND s.expires_at > NOW()
LIMIT 1;

-- name: DeleteSession :exec
DELETE FROM coregateway.sessions
WHERE id = $1;

-- name: DeleteSessionByTokenHash :exec
DELETE FROM coregateway.sessions
WHERE token_hash = $1;

-- name: DeleteUserSessions :exec
DELETE FROM coregateway.sessions
WHERE user_id = $1;

-- name: DeleteExpiredSessions :exec
DELETE FROM coregateway.sessions
WHERE expires_at <= NOW();

-- name: CountActiveSessions :one
SELECT COUNT(*) FROM coregateway.sessions WHERE expires_at > NOW();
