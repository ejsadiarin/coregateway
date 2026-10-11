package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/ejsadiarin/coregateway/internal/helper"
	"github.com/google/uuid"
)

// keyScopesContextKey carries the presented API key's scopes. It is set
// only for key-authed requests; session callers use the role path, so a
// missing key means "session (or anonymous)", never "zero privilege".
const keyScopesContextKey contextKey = "key-scopes"

// RequireIdentity establishes UserContext from the session cookie or, when
// no session exists, from a valid `Authorization: Bearer <api-key>` (which
// acts as its owner). Sessions win when both are present. Unknown/invalid
// keys get 401; requests without credentials pass through untouched so
// downstream gates (RequireAuth, in-handler checks) decide.
func RequireIdentity(sessions *Service, keys *KeysService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if GetUserFromContext(r) != nil {
				next.ServeHTTP(w, r)
				return
			}
			presented := bearerKey(r)
			if presented == "" {
				next.ServeHTTP(w, r)
				return
			}
			ownerID, _, scopes, err := keys.ValidateKey(r.Context(), presented)
			if err != nil {
				helper.RespondErrorJSON(w, http.StatusUnauthorized, "Authentication required")
				return
			}
			owner, err := sessions.GetUser(r.Context(), ownerID)
			if err != nil {
				helper.RespondErrorJSON(w, http.StatusUnauthorized, "Authentication required")
				return
			}
			id, _ := uuid.Parse(owner.Id)
			ctx := ContextWithUser(r.Context(), &UserContext{
				ID:    id,
				Email: owner.Email,
				Role:  owner.Role,
			})
			ctx = context.WithValue(ctx, keyScopesContextKey, scopes)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// KeyScopesFromContext returns the presented key's scopes. The second value
// is false for session-authed (or anonymous) requests.
func KeyScopesFromContext(r *http.Request) ([]string, bool) {
	scopes, ok := r.Context().Value(keyScopesContextKey).([]string)
	return scopes, ok
}

// KeyHasScope reports whether the caller authed via a key holding scope.
// Session callers always report false — they use the role path.
func KeyHasScope(r *http.Request, scope string) bool {
	scopes, ok := KeyScopesFromContext(r)
	if !ok {
		return false
	}
	for _, s := range scopes {
		if s == scope {
			return true
		}
	}
	return false
}

// RequireKeyScope enforces scope for key-authed callers: a presented key
// lacking scope gets 403. Session callers pass through to the role gates.
func RequireKeyScope(scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, ok := KeyScopesFromContext(r); ok && !KeyHasScope(r, scope) {
				helper.RespondErrorJSON(w, http.StatusForbidden, "Insufficient permissions")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// bearerKey extracts a Bearer token from the Authorization header.
func bearerKey(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}
