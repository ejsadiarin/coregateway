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
	"github.com/ejsadiarin/coregateway/internal/services/corefinance"
	"github.com/ejsadiarin/coregateway/internal/token"
)

// budgetScopeSetup wires a Server with a real issuer, a fake downstream,
// and the shared stub querier (admin/read/write keys). Queries stays nil:
// these tests never send ?user_id=, so the userExists closure never fires.
func budgetScopeSetup(t *testing.T) (*Server, *keyAuthStubQuerier, *fakeDownstream) {
	t.Helper()
	_, q, _, _ := keyAuthTestSetup(t)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	iss, err := token.NewIssuer(
		token.Key{KID: "2026-09-a", Private: priv, Public: pub},
		nil, "https://gateway.internal", []string{"corefinance"}, 300*time.Second,
	)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	fake := &fakeDownstream{}
	downstream := httptest.NewServer(fake)
	t.Cleanup(downstream.Close)
	s := &Server{
		TokenIssuer:       iss,
		CorefinanceClient: corefinance.New(downstream.URL),
		KeysService:       auth.NewKeysService(q),
	}
	return s, q, fake
}

func TestBudgetKeyScopeGate(t *testing.T) {
	t.Run("write-only key GET is 403 and unproxied", func(t *testing.T) {
		s, _, fake := budgetScopeSetup(t)
		rec := doKeyRequest(t, proxyRouter(s, "", uuid.Nil), testWriteKeyPlaintext, http.MethodGet, "/api/budget/remaining", "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if hits, _, _, _ := fake.snapshot(); hits != 0 {
			t.Errorf("downstream hits = %d, want 0 (never proxied)", hits)
		}
	})

	t.Run("read key GET proxies as owner", func(t *testing.T) {
		s, _, fake := budgetScopeSetup(t)
		rec := doKeyRequest(t, proxyRouter(s, "", uuid.Nil), testReadKeyPlaintext, http.MethodGet, "/api/budget/remaining", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if hits, _, _, _ := fake.snapshot(); hits != 1 {
			t.Errorf("downstream hits = %d, want 1", hits)
		}
	})

	t.Run("read-only key POST is 403 and unproxied", func(t *testing.T) {
		s, _, fake := budgetScopeSetup(t)
		rec := doKeyRequest(t, proxyRouter(s, "", uuid.Nil), testReadKeyPlaintext, http.MethodPost, "/api/budget/expenses", `{"amount":1}`)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if hits, _, _, _ := fake.snapshot(); hits != 0 {
			t.Errorf("downstream hits = %d, want 0 (never proxied)", hits)
		}
	})

	t.Run("user session GET unaffected", func(t *testing.T) {
		s, _, fake := budgetScopeSetup(t)
		_, _, _, userID := keyAuthTestSetup(t)
		rec := httptest.NewRecorder()
		proxyRouter(s, auth.RoleUser, userID).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/budget/remaining", nil))
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
		if hits, _, _, _ := fake.snapshot(); hits != 1 {
			t.Errorf("downstream hits = %d, want 1", hits)
		}
	})

	t.Run("admin key passes both methods", func(t *testing.T) {
		s, _, _ := budgetScopeSetup(t)
		h := proxyRouter(s, "", uuid.Nil)
		if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/budget/remaining", ""); rec.Code != http.StatusOK {
			t.Errorf("GET status = %d, want 200", rec.Code)
		}
		if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/budget/expenses", `{"amount":1}`); rec.Code != http.StatusOK {
			t.Errorf("POST status = %d, want 200", rec.Code)
		}
	})

	t.Run("anonymous still 401", func(t *testing.T) {
		s, _, fake := budgetScopeSetup(t)
		rec := doKeyRequest(t, proxyRouter(s, "", uuid.Nil), "", http.MethodGet, "/api/budget/remaining", "")
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401", rec.Code)
		}
		if hits, _, _, _ := fake.snapshot(); hits != 0 {
			t.Errorf("downstream hits = %d, want 0", hits)
		}
	})
}
