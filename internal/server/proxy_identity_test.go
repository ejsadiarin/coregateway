package server

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/config"
	"github.com/ejsadiarin/coregateway/internal/services/corefinance"
	"github.com/ejsadiarin/coregateway/internal/token"
)

// fakeDownstream records what the gateway proxy sends it.
type fakeDownstream struct {
	mu         sync.Mutex
	hits       int
	lastPath   string
	lastAuth   string
	lastUserID string
}

func (f *fakeDownstream) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hits++
	f.lastPath = r.URL.Path
	f.lastAuth = r.Header.Get("Authorization")
	f.lastUserID = r.Header.Get("X-User-ID")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"ok": "true"})
}

func (f *fakeDownstream) snapshot() (hits int, path, authHeader, userID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits, f.lastPath, f.lastAuth, f.lastUserID
}

func proxyTestSetup(t *testing.T) (*Server, *fakeDownstream, *token.Issuer) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	iss, err := token.NewIssuer(
		token.Key{KID: "2026-09-a", Private: priv, Public: pub},
		nil, "https://gateway.internal", "corefinance", 300*time.Second,
	)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	fake := &fakeDownstream{}
	downstream := httptest.NewServer(fake)
	t.Cleanup(downstream.Close)
	// NOTE: KeysService is nil here, so these tests never present bearer
	// keys — the session branch returns before the validator is touched.
	s := &Server{
		TokenIssuer:       iss,
		CorefinanceClient: corefinance.New(downstream.URL),
	}
	return s, fake, iss
}

// proxyRouter wraps the real route table. With role == "" no identity is
// injected (anonymous). The global AuthMiddleware passes cookie-less
// requests through untouched, so injected identities reach EdgeIdentity
// exactly like validated sessions.
func proxyRouter(s *Server, role string, id uuid.UUID) http.Handler {
	var h http.Handler = s.RegisterRoutes(&config.Config{})
	if role == "" {
		return h
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := auth.ContextWithUser(r.Context(), &auth.UserContext{
			ID:    id,
			Email: role + "@example.com",
			Role:  role,
		})
		h.ServeHTTP(w, r.WithContext(ctx))
	})
}

func parseDownstreamToken(t *testing.T, iss *token.Issuer, header string) token.Claims {
	t.Helper()
	if len(header) < 8 || header[:7] != "Bearer " {
		t.Fatalf("downstream Authorization is not bearer: %q", header)
	}
	var claims token.Claims
	parsed, err := jwt.ParseWithClaims(header[7:], &claims, func(t *jwt.Token) (any, error) {
		return iss.Keys()[0].Public, nil
	})
	if err != nil || !parsed.Valid {
		t.Fatalf("downstream token does not verify: %v", err)
	}
	return claims
}

func TestProxyRequiresIdentity(t *testing.T) {
	s, fake, _ := proxyTestSetup(t)

	rec := httptest.NewRecorder()
	proxyRouter(s, "", uuid.Nil).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/budget/expenses/", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
	if hits, _, _, _ := fake.snapshot(); hits != 0 {
		t.Error("unauthenticated request must not reach downstream")
	}
}

func TestProxyForwardsSessionJWT(t *testing.T) {
	userID := uuid.New()
	s, fake, iss := proxyTestSetup(t)

	rec := httptest.NewRecorder()
	proxyRouter(s, auth.RoleUser, userID).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/budget/expenses/", nil))

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	hits, path, authHeader, userIDHeader := fake.snapshot()
	if hits != 1 {
		t.Fatalf("downstream hits = %d, want 1", hits)
	}
	if path != "/api/budget/expenses/" {
		t.Errorf("downstream path = %q", path)
	}
	if userIDHeader != "" {
		t.Errorf("downstream X-User-ID = %q, must be absent", userIDHeader)
	}
	claims := parseDownstreamToken(t, iss, authHeader)
	if claims.Subject != userID.String() {
		t.Errorf("sub = %q, want %q", claims.Subject, userID.String())
	}
	if claims.Azp != "session" {
		t.Errorf("azp = %q", claims.Azp)
	}
}

func TestProxyAdminPathRequiresScope(t *testing.T) {
	// Non-admin session against the admin path: 403 before proxying.
	// This also proves chi routes /admin/* to the scope gate, not the
	// /* catch-all.
	s, fake, _ := proxyTestSetup(t)
	rec := httptest.NewRecorder()
	proxyRouter(s, auth.RoleUser, uuid.New()).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/budget/admin/backfill", nil))

	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Code)
	}
	if hits, _, _, _ := fake.snapshot(); hits != 0 {
		t.Error("unscoped admin request must not reach downstream")
	}

	// Admin session: proxied with the admin scope in the token.
	s2, fake2, iss2 := proxyTestSetup(t)
	rec2 := httptest.NewRecorder()
	proxyRouter(s2, auth.RoleAdmin, uuid.New()).ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/api/budget/admin/backfill", nil))

	if rec2.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec2.Code)
	}
	_, _, authHeader, _ := fake2.snapshot()
	if claims := parseDownstreamToken(t, iss2, authHeader); claims.Scope != "admin" {
		t.Errorf("scope = %q, want admin", claims.Scope)
	}
}
