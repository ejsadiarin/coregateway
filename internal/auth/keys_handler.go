package auth

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/ejsadiarin/coregateway/internal/helper"
	"github.com/ejsadiarin/coregateway/internal/token"
	"github.com/google/uuid"
)

// KeysHandler serves session-authenticated, admin-gated API key management
// under /api/auth/keys, plus the public token exchange.
type KeysHandler struct {
	keys   *KeysService
	issuer *token.Issuer
}

// NewKeysHandler builds a KeysHandler over a KeysService and the token
// issuer used by the exchange endpoint.
func NewKeysHandler(keys *KeysService, issuer *token.Issuer) *KeysHandler {
	return &KeysHandler{keys: keys, issuer: issuer}
}

type createKeyHTTPRequest struct {
	Label     string     `json:"label"`
	Scopes    []string   `json:"scopes"`
	ExpiresAt *time.Time `json:"expires_at"`
}

type keyHTTPResponse struct {
	ID        uuid.UUID  `json:"id"`
	Key       string     `json:"key,omitempty"`
	KeyPrefix string     `json:"key_prefix"`
	Label     string     `json:"label"`
	Scopes    []string   `json:"scopes"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// Create issues a key. The plaintext appears in this response only.
func (h *KeysHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createKeyHTTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		helper.RespondErrorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	caller := GetUserFromContext(r)
	plaintext, row, err := h.keys.CreateKey(r.Context(), CreateKeyRequest{
		Label:     req.Label,
		OwnerID:   &caller.ID,
		Scopes:    req.Scopes,
		ExpiresAt: req.ExpiresAt,
	})
	if err != nil {
		slog.Error("keys.Create: failed", "error", err)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to create API key")
		return
	}
	resp := keyHTTPResponse{
		ID:        row.ID,
		Key:       plaintext,
		KeyPrefix: row.KeyPrefix,
		Label:     row.Label,
		Scopes:    row.Scopes,
		CreatedAt: row.CreatedAt.Time,
	}
	if row.ExpiresAt.Valid {
		resp.ExpiresAt = &row.ExpiresAt.Time
	}
	helper.RespondJSON(w, http.StatusCreated, resp)
}

// List returns key metadata. Hashes and plaintext never appear here.
func (h *KeysHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.keys.ListKeys(r.Context())
	if err != nil {
		slog.Error("keys.List: failed", "error", err)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to list API keys")
		return
	}
	out := make([]keyHTTPResponse, 0, len(rows))
	for _, row := range rows {
		resp := keyHTTPResponse{
			ID:        row.ID,
			KeyPrefix: row.KeyPrefix,
			Label:     row.Label,
			Scopes:    row.Scopes,
			CreatedAt: row.CreatedAt.Time,
		}
		if row.ExpiresAt.Valid {
			exp := row.ExpiresAt.Time
			resp.ExpiresAt = &exp
		}
		out = append(out, resp)
	}
	helper.RespondJSON(w, http.StatusOK, out)
}

// Revoke marks a key revoked with immediate effect.
func (h *KeysHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	id, ok := helper.ParseUUID(w, r, "id")
	if !ok {
		return
	}
	if err := h.keys.RevokeKey(r.Context(), id); err != nil {
		if err == ErrKeyNotFound {
			helper.RespondErrorJSON(w, http.StatusNotFound, "API key not found")
			return
		}
		slog.Error("keys.Revoke: failed", "error", err)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to revoke API key")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type exchangeRequest struct {
	Key string `json:"key"`
}

type exchangeResponse struct {
	TokenType string `json:"token_type"`
	Token     string `json:"token"`
	ExpiresIn int    `json:"expires_in"`
}

// Exchange trades a valid ownerless (service) key for a short-lived
// service JWT. It is public: the presented key is the credential. Owned
// (human) keys are rejected — exchanging one would silently drop the
// user's identity, so those callers use the proxy leg instead.
func (h *KeysHandler) Exchange(w http.ResponseWriter, r *http.Request) {
	var req exchangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Key == "" {
		helper.RespondErrorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	row, err := h.keys.ValidateServiceKey(r.Context(), req.Key)
	if err != nil {
		switch err {
		case ErrInvalidKey:
			helper.RespondErrorJSON(w, http.StatusUnauthorized, "Invalid API key")
			return
		case ErrNotServiceKey:
			helper.RespondErrorJSON(w, http.StatusForbidden, "Key is not a service key")
			return
		default:
			slog.Error("keys.Exchange: failed", "error", err)
			helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to exchange API key")
			return
		}
	}
	signed, err := h.issuer.CreateServiceToken(row.Label, row.Scopes)
	if err != nil {
		slog.Error("keys.Exchange: failed to create token", "error", err)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to create token")
		return
	}
	slog.Info("keys.Exchange: service token issued", "key_id", row.ID, "label", row.Label)
	helper.RespondJSON(w, http.StatusOK, exchangeResponse{
		TokenType: "Bearer",
		Token:     signed,
		ExpiresIn: int(h.issuer.TTL().Seconds()),
	})
}
