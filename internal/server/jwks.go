package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/ejsadiarin/coregateway/internal/helper"
)

// ServeJWKS serves the gateway's public signing keys (RFC 7517) so
// downstream services can verify internal JWTs. Public material only,
// no authentication required.
//
// The key set changes only on rotation, so the response carries an ETag
// derived from the serialized document and honours If-None-Match with
// 304: a verifier polling every cache window gets no body instead of the
// same keys.
func (s *Server) ServeJWKS(w http.ResponseWriter, r *http.Request) {
	body, err := json.Marshal(s.TokenIssuer.JWKS())
	if err != nil {
		slog.Error("failed to encode JWKS", "error", err)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to encode JWKS")
		return
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`

	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("ETag", etag)
	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(body); err != nil {
		slog.Info("failed to write jwks response", "error", err.Error())
	}
}

// etagMatches reports whether an If-None-Match header covers etag,
// honouring "*", comma-separated lists, and weak validators.
func etagMatches(header, etag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
			return true
		}
	}
	return false
}
