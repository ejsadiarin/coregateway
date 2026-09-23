package auth

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/ejsadiarin/coregateway/internal/helper"
	"github.com/google/uuid"
)

// KeysHandler serves session-authenticated, admin-gated API key management
// under /api/auth/keys.
type KeysHandler struct {
	keys *KeysService
}

// NewKeysHandler builds a KeysHandler over a KeysService.
func NewKeysHandler(keys *KeysService) *KeysHandler {
	return &KeysHandler{keys: keys}
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
