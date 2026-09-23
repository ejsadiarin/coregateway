package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/ejsadiarin/coregateway/internal/crypto"
	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ApiKeyPrefix identifies gateway-issued keys at a glance. The prefix is
// stored alongside the row; only the hash authenticates.
const ApiKeyPrefix = "cgw_live_"

var (
	// ErrInvalidKey covers unknown, revoked, and expired keys alike so
	// validation reveals nothing about which condition failed.
	ErrInvalidKey = errors.New("invalid API key")
	// ErrKeyNotFound covers missing and already-revoked keys on management calls.
	ErrKeyNotFound = errors.New("API key not found")
	// ErrNotServiceKey rejects owned (human) keys at the token exchange,
	// where exchanging would silently drop the user's identity.
	ErrNotServiceKey = errors.New("key is not a service key")
)

// KeysService owns the api_keys lifecycle: issuance, validation at the
// edge, and session-authenticated management. Plaintext exists only in
// memory at creation; storage and logs see hashes and metadata only.
type KeysService struct {
	queries db.Querier
}

// NewKeysService builds a KeysService over sqlc queries.
func NewKeysService(queries db.Querier) *KeysService {
	return &KeysService{queries: queries}
}

// GenerateAPIKey creates a 256-bit random key with a recognizable prefix
// and returns the plaintext plus its SHA-256 hex digest for storage.
func GenerateAPIKey() (plaintext, hash string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("failed to generate key material: %w", err)
	}
	plaintext = ApiKeyPrefix + base64.RawURLEncoding.EncodeToString(raw)
	return plaintext, crypto.HashSessionToken(plaintext), nil
}

// HashAPIKey digests a presented key for lookup. Keys are high-entropy
// random tokens, so a fast indexed hash lookup is correct here.
func HashAPIKey(presented string) string {
	sum := sha256.Sum256([]byte(presented))
	return hex.EncodeToString(sum[:])
}

// CreateKeyRequest carries key creation parameters. ExpiresAt nil means
// the key never expires; OwnerID nil means the key is ownerless (service use).
type CreateKeyRequest struct {
	Label     string
	OwnerID   *uuid.UUID
	Scopes    []string
	ExpiresAt *time.Time
}

// CreateKey stores a new key row and returns the plaintext exactly once.
func (s *KeysService) CreateKey(ctx context.Context, req CreateKeyRequest) (plaintext string, row db.CoregatewayApiKey, err error) {
	if req.Label == "" {
		return "", db.CoregatewayApiKey{}, fmt.Errorf("label is required")
	}
	plaintext, hash, err := GenerateAPIKey()
	if err != nil {
		return "", db.CoregatewayApiKey{}, err
	}
	scopes := req.Scopes
	if scopes == nil {
		scopes = []string{}
	}
	params := db.CreateApiKeyParams{
		KeyPrefix: ApiKeyPrefix,
		KeyHash:   hash,
		Label:     req.Label,
		Scopes:    scopes,
	}
	if req.OwnerID != nil {
		params.OwnerUserID = pgtype.UUID{Bytes: *req.OwnerID, Valid: true}
	}
	if req.ExpiresAt != nil {
		params.ExpiresAt = pgtype.Timestamptz{Time: *req.ExpiresAt, Valid: true}
	}
	row, err = s.queries.CreateApiKey(ctx, params)
	if err != nil {
		return "", db.CoregatewayApiKey{}, fmt.Errorf("failed to store API key: %w", err)
	}
	slog.Info("apikeys: key created", "key_id", row.ID, "label", req.Label)
	return plaintext, row, nil
}

// ListKeys returns key metadata newest-first. Hashes are never selected.
func (s *KeysService) ListKeys(ctx context.Context) ([]db.ListApiKeysRow, error) {
	return s.queries.ListApiKeys(ctx)
}

// RevokeKey marks a key revoked. Missing or already-revoked keys report
// ErrKeyNotFound so callers cannot distinguish the two.
func (s *KeysService) RevokeKey(ctx context.Context, id uuid.UUID) error {
	n, err := s.queries.RevokeApiKey(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to revoke API key: %w", err)
	}
	if n == 0 {
		return ErrKeyNotFound
	}
	slog.Info("apikeys: key revoked", "key_id", id)
	return nil
}

// validatedRow hashes the presented key, looks it up, and enforces
// live/unrevoked/unexpired. Unknown, revoked, and expired keys all report
// ErrInvalidKey so validation reveals nothing about which failed.
func (s *KeysService) validatedRow(ctx context.Context, presented string) (db.CoregatewayApiKey, error) {
	row, err := s.queries.GetApiKeyByHash(ctx, HashAPIKey(presented))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.CoregatewayApiKey{}, ErrInvalidKey
		}
		return db.CoregatewayApiKey{}, fmt.Errorf("key lookup failed: %w", err)
	}
	if row.RevokedAt.Valid {
		return db.CoregatewayApiKey{}, ErrInvalidKey
	}
	if row.ExpiresAt.Valid && time.Now().After(row.ExpiresAt.Time) {
		return db.CoregatewayApiKey{}, ErrInvalidKey
	}
	s.touchLastUsed(row.ID)
	return row, nil
}

// ValidateKey implements middleware.APIKeyValidator. Ownerless (service)
// keys return uuid.Nil as the user: the proxy leg rejects those (it needs
// a user), while the token exchange accepts them.
func (s *KeysService) ValidateKey(ctx context.Context, presented string) (userID uuid.UUID, keyID string, scopes []string, err error) {
	row, err := s.validatedRow(ctx, presented)
	if err != nil {
		return uuid.Nil, "", nil, err
	}
	if row.OwnerUserID.Valid {
		userID = row.OwnerUserID.Bytes
	}
	return userID, row.ID.String(), row.Scopes, nil
}

// ValidateServiceKey validates a key for the token exchange. Only
// ownerless keys qualify: an owned (human) key exchanged here would mint
// a user-less token and silently drop the user's identity, so owned keys
// are rejected outright.
func (s *KeysService) ValidateServiceKey(ctx context.Context, presented string) (db.CoregatewayApiKey, error) {
	row, err := s.validatedRow(ctx, presented)
	if err != nil {
		return db.CoregatewayApiKey{}, err
	}
	if row.OwnerUserID.Valid {
		return db.CoregatewayApiKey{}, ErrNotServiceKey
	}
	return row, nil
}

// touchLastUsed updates last_used_at off the request path. Failures are
// best-effort by design and never fail the authenticated request.
func (s *KeysService) touchLastUsed(id uuid.UUID) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.queries.TouchApiKeyLastUsed(ctx, id); err != nil {
			slog.Debug("apikeys: last_used update failed", "key_id", id, "error", err)
		}
	}()
}
