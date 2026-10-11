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

// UserExistsFunc reports whether a user id exists. It backs ?user_id=
// validation at the edge, keeping user authority in the gateway.
type UserExistsFunc func(ctx context.Context, id uuid.UUID) (bool, error)

// EdgeIdentity authenticates proxied requests once at the edge and creates
// the short-lived internal JWT that downstream services verify. It accepts
// a valid session (populated by the global AuthMiddleware) or, when a
// validator is configured, a valid API key. Anything else is rejected with
// 401 and never proxied. The created token is the only identity that
// travels downstream.
//
// On GET/HEAD requests carrying ?user_id=<uuid>, the edge validates the
// target (malformed → 400, other-target without admin scope → 403,
// unknown user → 404) and mints a signed act_as claim, stripping the raw
// param. Non-GET/HEAD requests ignore the param entirely.
func EdgeIdentity(issuer *token.Issuer, keys APIKeyValidator, userExists UserExistsFunc) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var userID uuid.UUID
			var azp string
			var scopes []string
			if user := auth.GetUserFromContext(r); user != nil {
				// The edge knows the user's role; downstream does not. Grant
				// the admin scope here so admin endpoints can authorize
				// locally from the verified scope claim.
				if user.Role == auth.RoleAdmin {
					scopes = []string{"admin"}
				}
				userID, azp = user.ID, "session"
			} else if keys != nil {
				if presented, ok := bearerToken(r); ok {
					id, keyID, keyScopes, err := keys.ValidateKey(r.Context(), presented)
					// All keys are owned; validity alone suffices.
					if err == nil {
						userID, azp, scopes = id, "api-key:"+keyID, keyScopes
					}
				}
			}
			if userID == uuid.Nil {
				helper.RespondErrorJSON(w, http.StatusUnauthorized, "Authentication required")
				return
			}
			actAs, ok := targeting(w, r, userID, scopes, userExists)
			if !ok {
				return // targeting already responded
			}
			issue(w, r, next, issuer, userID, azp, scopes, actAs)
		})
	}
}

// targeting validates ?user_id= on reads and returns the act_as target
// (uuid.Nil for self/untargeted). It strips the raw param in all cases and
// responds directly on rejection, returning ok=false.
func targeting(w http.ResponseWriter, r *http.Request, caller uuid.UUID, scopes []string, userExists UserExistsFunc) (actAs uuid.UUID, ok bool) {
	raw := r.URL.Query().Get("user_id")
	strip := func() {
		q := r.URL.Query()
		q.Del("user_id")
		r.URL.RawQuery = q.Encode()
	}
	if raw == "" {
		return uuid.Nil, true
	}
	// Writes never target: strip silently, validate nothing.
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		strip()
		return uuid.Nil, true
	}
	target, err := uuid.Parse(raw)
	if err != nil {
		helper.RespondErrorJSON(w, http.StatusBadRequest, "invalid user_id")
		return uuid.Nil, false
	}
	strip()
	if target == caller {
		return uuid.Nil, true // own ID: exists by construction
	}
	admin := false
	for _, s := range scopes {
		if s == "admin" {
			admin = true
			break
		}
	}
	if !admin {
		helper.RespondErrorJSON(w, http.StatusForbidden, "Insufficient permissions")
		return uuid.Nil, false
	}
	if userExists == nil {
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to validate target user")
		return uuid.Nil, false
	}
	exists, err := userExists(r.Context(), target)
	if err != nil {
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to validate target user")
		return uuid.Nil, false
	}
	if !exists {
		helper.RespondErrorJSON(w, http.StatusNotFound, "target user not found")
		return uuid.Nil, false
	}
	return target, true
}

func issue(w http.ResponseWriter, r *http.Request, next http.Handler, issuer *token.Issuer, userID uuid.UUID, azp string, scopes []string, actAs uuid.UUID) {
	signed, err := issuer.CreateTargetedToken(userID, azp, scopes, actAs)
	if err != nil {
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to establish request identity")
		return
	}
	r.Header.Set("Authorization", "Bearer "+signed)
	// A client-supplied X-User-ID must never ride the proxy downstream:
	// identity travels exclusively as the minted JWT. Strip it here so
	// both the session and API-key paths are covered. The session cookie
	// stays at the edge for the same reason: downstream authenticates via
	// the JWT and never reads cookies.
	r.Header.Del("X-User-ID")
	r.Header.Del("Cookie")
	// Carry the edge-established scopes in-process for RequireScope.
	next.ServeHTTP(w, r.WithContext(withScopes(r.Context(), scopes)))
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
