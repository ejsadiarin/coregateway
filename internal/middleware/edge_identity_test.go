package middleware

import (
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/token"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func testIssuer(t *testing.T) *token.Issuer {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	iss, err := token.NewIssuer(
		token.Key{KID: "2026-09-a", Private: priv, Public: pub},
		nil,
		"https://gateway.internal",
		"corefinance",
		300*time.Second,
	)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	return iss
}

func requestWithUser(r *http.Request, id uuid.UUID) *http.Request {
	return r.WithContext(auth.ContextWithUser(r.Context(), &auth.UserContext{
		ID:    id,
		Email: "test@example.com",
		Role:  "user",
	}))
}

func TestEdgeIdentitySessionMintsJWT(t *testing.T) {
	iss := testIssuer(t)
	userID := uuid.New()

	var gotAuth, gotUserID string
	var nextCalled bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		gotAuth = r.Header.Get("Authorization")
		gotUserID = r.Header.Get("X-User-ID")
	})

	req := requestWithUser(httptest.NewRequest(http.MethodGet, "/api/budget/remaining", nil), userID)
	EdgeIdentity(iss, nil)(next).ServeHTTP(httptest.NewRecorder(), req)

	if !nextCalled {
		t.Fatal("expected next handler to be called")
	}
	if gotUserID != "" {
		t.Errorf("X-User-ID = %q, must not be emitted", gotUserID)
	}
	presented, ok := bearerToken(mustRequest(t, gotAuth))
	if !ok {
		t.Fatalf("Authorization header is not a bearer token: %q", gotAuth)
	}
	var claims token.Claims
	parsed, err := jwt.ParseWithClaims(presented, &claims, func(t *jwt.Token) (any, error) {
		return iss.Keys()[0].Public, nil
	})
	if err != nil || !parsed.Valid {
		t.Fatalf("minted token does not verify: %v", err)
	}
	if claims.Subject != userID.String() {
		t.Errorf("sub = %q, want %q", claims.Subject, userID.String())
	}
	if claims.Azp != "session" {
		t.Errorf("azp = %q, want session", claims.Azp)
	}
}

func TestEdgeIdentityAdminSessionGrantsAdminScope(t *testing.T) {
	iss := testIssuer(t)

	var gotAuth string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
	})

	req := httptest.NewRequest(http.MethodGet, "/api/budget/admin/backfill", nil)
	req = req.WithContext(auth.ContextWithUser(req.Context(), &auth.UserContext{
		ID:    uuid.New(),
		Email: "admin@example.com",
		Role:  auth.RoleAdmin,
	}))
	EdgeIdentity(iss, nil)(next).ServeHTTP(httptest.NewRecorder(), req)

	presented, ok := bearerToken(mustRequest(t, gotAuth))
	if !ok {
		t.Fatalf("Authorization header is not a bearer token: %q", gotAuth)
	}
	var claims token.Claims
	if _, err := jwt.ParseWithClaims(presented, &claims, func(t *jwt.Token) (any, error) {
		return iss.Keys()[0].Public, nil
	}); err != nil {
		t.Fatalf("minted token does not verify: %v", err)
	}
	if claims.Scope != "admin" {
		t.Errorf("scope = %q, want admin", claims.Scope)
	}
}

func mustRequest(t *testing.T, authHeader string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", authHeader)
	return req
}

func TestEdgeIdentityAnonymousRejected(t *testing.T) {
	iss := testIssuer(t)
	nextCalled := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/budget/remaining", nil)
	EdgeIdentity(iss, nil)(next).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
	if nextCalled {
		t.Error("next handler must not be called without identity")
	}
}

func TestEdgeIdentityMalformedBearerRejected(t *testing.T) {
	iss := testIssuer(t)
	nextCalled := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
	})

	for _, header := range []string{"Bearer", "Bearer ", "Token abc", ""} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/budget/remaining", nil)
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		EdgeIdentity(iss, nil)(next).ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("header %q: status = %d, want 401", header, rec.Code)
		}
	}
	if nextCalled {
		t.Error("next handler must not be called")
	}
}

func TestForwardHeadersReemitFlag(t *testing.T) {
	userID := uuid.New()

	withUser := func() *http.Request {
		return requestWithUser(httptest.NewRequest(http.MethodGet, "/", nil), userID)
	}

	// X-User-ID is set on the outgoing request object; capture via next handler.
	var emitted string
	ForwardHeaders(true)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		emitted = r.Header.Get("X-User-ID")
	})).ServeHTTP(httptest.NewRecorder(), withUser())
	if emitted != userID.String() {
		t.Errorf("re-emit on: X-User-ID = %q, want %q", emitted, userID.String())
	}

	emitted = "unset-sentinel"
	ForwardHeaders(false)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		emitted = r.Header.Get("X-User-ID")
	})).ServeHTTP(httptest.NewRecorder(), withUser())
	if emitted != "" {
		t.Errorf("re-emit off: X-User-ID = %q, want empty", emitted)
	}
}

func TestBearerTokenHelper(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer abc123")
	v, ok := bearerToken(req)
	if !ok || v != "abc123" {
		t.Errorf("got %q, %v", v, ok)
	}
	if strings.Contains(v, " ") {
		t.Error("token must not contain spaces")
	}
}
