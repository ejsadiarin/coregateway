package middleware

import (
	"context"
	"net/http"

	"github.com/ejsadiarin/coregateway/internal/helper"
)

type scopesContextKey struct{}

// withScopes stores the edge-established scope list on the request context
// for downstream middleware (e.g. RequireScope) in the same process.
func withScopes(ctx context.Context, scopes []string) context.Context {
	return context.WithValue(ctx, scopesContextKey{}, scopes)
}

// scopesFromContext reads the edge-established scope list; empty when none.
func scopesFromContext(ctx context.Context) []string {
	scopes, _ := ctx.Value(scopesContextKey{}).([]string)
	return scopes
}

// RequireScope rejects requests whose edge-established scopes lack scope.
// It runs after EdgeIdentity on route groups that need more than identity
// (e.g. /api/budget/admin/* requires "admin"). Missing scope is 403:
// identity was established, privilege was not.
func RequireScope(scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, s := range scopesFromContext(r.Context()) {
				if s == scope {
					next.ServeHTTP(w, r)
					return
				}
			}
			helper.RespondErrorJSON(w, http.StatusForbidden, "Insufficient permissions")
		})
	}
}
