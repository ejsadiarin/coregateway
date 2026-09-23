package server

import (
	"net/http"

	"github.com/ejsadiarin/coregateway/internal/helper"
)

// ServeJWKS serves the gateway's public signing keys (RFC 7517) so
// downstream services can verify internal JWTs. Public material only,
// no authentication required.
func (s *Server) ServeJWKS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=300")
	helper.RespondJSON(w, http.StatusOK, s.TokenIssuer.JWKS())
}
