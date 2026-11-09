package server

import (
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/services/coreban"
	"github.com/ejsadiarin/coregateway/internal/token"
)

// corebanScopeSetup wires a Server with a real issuer, a fake downstream,
// and the shared stub querier (admin/coreban-read/coreban-write keys).
// Queries stays nil: these tests never send ?user_id=, so the userExists
// closure never fires.
func corebanScopeSetup(t *testing.T) (*Server, *keyAuthStubQuerier, *fakeDownstream) {
	s, q, fake, _ := corebanScopeSetupWithIssuer(t)
	return s, q, fake
}

func corebanScopeSetupWithIssuer(t *testing.T) (*Server, *keyAuthStubQuerier, *fakeDownstream, *token.Issuer) {
	t.Helper()
	_, q, _, _ := keyAuthTestSetup(t)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	iss, err := token.NewIssuer(
		token.Key{KID: "2026-09-a", Private: priv, Public: pub},
		nil, "https://gateway.internal", []string{"corefinance", "coredraw", "coreban"}, 300*time.Second,
	)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	fake := &fakeDownstream{}
	downstream := httptest.NewServer(fake)
	t.Cleanup(downstream.Close)
	s := &Server{
		TokenIssuer:   iss,
		CorebanClient: coreban.New(downstream.URL),
		KeysService:   auth.NewKeysService(q),
	}
	return s, q, fake, iss
}

func TestCorebanKeyScopeGate(t *testing.T) {
	t.Run("write-only key GET is 403 and unproxied", func(t *testing.T) {
		s, _, fake := corebanScopeSetup(t)
		rec := doKeyRequest(t, proxyRouter(s, "", uuid.Nil), testCorebanWriteKeyPlaintext, http.MethodGet, "/api/coreban/tasks", "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if hits, _, _, _ := fake.snapshot(); hits != 0 {
			t.Errorf("downstream hits = %d, want 0 (never proxied)", hits)
		}
	})

	t.Run("read key GET proxies with a coreban-audience token, path unchanged", func(t *testing.T) {
		s, _, fake, iss := corebanScopeSetupWithIssuer(t)
		rec := doKeyRequest(t, proxyRouter(s, "", uuid.Nil), testCorebanReadKeyPlaintext, http.MethodGet, "/api/coreban/tasks", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		hits, path, authHeader, _ := fake.snapshot()
		if hits != 1 {
			t.Errorf("downstream hits = %d, want 1", hits)
		}
		if path != "/api/coreban/tasks" {
			t.Errorf("downstream path = %q, want /api/coreban/tasks", path)
		}
		claims := parseDownstreamToken(t, iss, authHeader)
		if len(claims.Audience) != 1 || claims.Audience[0] != "coreban" {
			t.Errorf("token audience = %v, want [coreban]", claims.Audience)
		}
	})

	t.Run("read-only key PUT is 403 and unproxied", func(t *testing.T) {
		s, _, fake := corebanScopeSetup(t)
		rec := doKeyRequest(t, proxyRouter(s, "", uuid.Nil), testCorebanReadKeyPlaintext, http.MethodPut, "/api/coreban/tasks/"+uuid.New().String(), `{"revision":1}`)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if hits, _, _, _ := fake.snapshot(); hits != 0 {
			t.Errorf("downstream hits = %d, want 0 (never proxied)", hits)
		}
	})

	t.Run("user session GET unaffected", func(t *testing.T) {
		s, _, fake := corebanScopeSetup(t)
		_, _, _, userID := keyAuthTestSetup(t)
		rec := httptest.NewRecorder()
		proxyRouter(s, auth.RoleUser, userID).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/coreban/tasks", nil))
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
		if hits, _, _, _ := fake.snapshot(); hits != 1 {
			t.Errorf("downstream hits = %d, want 1", hits)
		}
	})

	t.Run("admin key passes both methods", func(t *testing.T) {
		s, _, _ := corebanScopeSetup(t)
		h := proxyRouter(s, "", uuid.Nil)
		if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/coreban/tasks", ""); rec.Code != http.StatusOK {
			t.Errorf("GET status = %d, want 200", rec.Code)
		}
		if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPut, "/api/coreban/tasks/"+uuid.New().String(), `{"revision":1}`); rec.Code != http.StatusOK {
			t.Errorf("PUT status = %d, want 200", rec.Code)
		}
	})

	t.Run("anonymous still 401", func(t *testing.T) {
		s, _, fake := corebanScopeSetup(t)
		rec := doKeyRequest(t, proxyRouter(s, "", uuid.Nil), "", http.MethodGet, "/api/coreban/tasks", "")
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401", rec.Code)
		}
		if hits, _, _, _ := fake.snapshot(); hits != 0 {
			t.Errorf("downstream hits = %d, want 0", hits)
		}
	})
}
