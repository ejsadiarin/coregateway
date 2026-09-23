package server

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ejsadiarin/coregateway/internal/token"
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

func TestServeJWKS(t *testing.T) {
	s := &Server{TokenIssuer: testIssuer(t)}

	req := httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil)
	rec := httptest.NewRecorder()
	s.ServeJWKS(rec, req)

	res := rec.Result()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if cc := res.Header.Get("Cache-Control"); cc == "" {
		t.Error("expected Cache-Control header")
	}
	var doc struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			Alg string `json:"alg"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&doc); err != nil {
		t.Fatalf("decode jwks: %v", err)
	}
	if len(doc.Keys) != 1 || doc.Keys[0].Kid != "2026-09-a" {
		t.Errorf("keys = %+v", doc.Keys)
	}
	if doc.Keys[0].Kty != "OKP" || doc.Keys[0].Alg != "EdDSA" {
		t.Errorf("key = %+v", doc.Keys[0])
	}
}
