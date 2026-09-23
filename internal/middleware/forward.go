package middleware

import (
	"net/http"

	"github.com/ejsadiarin/coregateway/internal/auth"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

// ForwardHeaders propagates request correlation headers on requests
// forwarded to a downstream microservice via reverse proxy. Identity
// travels exclusively as the internal JWT (set by EdgeIdentity); the
// legacy X-User-ID header is only re-emitted when reemitUserID is true,
// a transitional cutover flag that defaults to false.
//
// Use this on route groups that proxy to microservices:
//
//	r.Route("/api/budget", func(r chi.Router) {
//	    r.Use(middleware.EdgeIdentity(issuer, keys))
//	    r.Use(middleware.ForwardHeaders(false))
//	    r.Handle("/*", corefinanceClient.Proxy())
//	})
func ForwardHeaders(reemitUserID bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if id := chiMiddleware.GetReqID(r.Context()); id != "" {
				r.Header.Set("X-Request-ID", id)
			}
			if reemitUserID {
				if user := auth.GetUserFromContext(r); user != nil {
					r.Header.Set("X-User-ID", user.ID.String())
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
