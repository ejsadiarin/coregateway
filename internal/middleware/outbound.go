package middleware

import (
	"context"
	"net/http"

	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

// PropagateHeaders sets X-Request-ID on an outbound request
// using the incoming request's context. Call this before client.Do(req).
// For background tasks without an incoming request, pass context.Background() via
// a wrapper request or skip this call.
func PropagateHeaders(outbound *http.Request, incoming *http.Request) {
	ctx := incoming.Context()
	PropagateHeadersFromContext(outbound, ctx)
}

// PropagateHeadersFromContext sets X-Request-ID on an outbound request
// from the given context directly. It never sets X-User-ID: user identity
// travels exclusively as the gateway-minted internal JWT.
func PropagateHeadersFromContext(outbound *http.Request, ctx context.Context) {
	if id := chiMiddleware.GetReqID(ctx); id != "" {
		outbound.Header.Set("X-Request-ID", id)
	}
}
