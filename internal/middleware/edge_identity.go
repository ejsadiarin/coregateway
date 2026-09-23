package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/helper"
	"github.com/ejsadiarin/coregateway/internal/token"
	"github.com/google/uuid"
)

// APIKeyValidator validates a presented user API key at the edge and
// returns the owning user, the key id (for azp), and its scopes.
// The sqlc-backed implementation lands with the api_keys table (§5);
// a nil validator disables the key path.
type APIKeyValidator interface {
	ValidateKey(ctx context.Context, presented string) (userID uuid.UUID, keyID string, scopes []string, err error)
}

// EdgeIdentity authenticates proxied requests once at the edge and creates
// the short-lived internal JWT that downstream services verify. It accepts
// a valid session (populated by the global AuthMiddleware) or, when a
// validator is configured, a valid API key. Anything else is rejected with
// 401 and never proxied. The created token is the only identity that
// travels downstream.
func EdgeIdentity(issuer *token.Issuer, keys APIKeyValidator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user := auth.GetUserFromContext(r); user != nil {
				issue(w, r, next, issuer, user.ID, "session", nil)
				return
			}
			if keys != nil {
				if presented, ok := bearerToken(r); ok {
					if userID, keyID, scopes, err := keys.ValidateKey(r.Context(), presented); err == nil {
						issue(w, r, next, issuer, userID, "api-key:"+keyID, scopes)
						return
					}
				}
			}
			helper.RespondErrorJSON(w, http.StatusUnauthorized, "Authentication required")
		})
	}
}

func issue(w http.ResponseWriter, r *http.Request, next http.Handler, issuer *token.Issuer, userID uuid.UUID, azp string, scopes []string) {
	signed, err := issuer.CreateUserToken(userID, azp, scopes)
	if err != nil {
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to establish request identity")
		return
	}
	r.Header.Set("Authorization", "Bearer "+signed)
	next.ServeHTTP(w, r)
}

func bearerToken(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	if h == "" {
		return "", false
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") || parts[1] == "" {
		return "", false
	}
	return parts[1], true
}
