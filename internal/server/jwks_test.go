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
		[]string{"corefinance"},
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

func TestServeJWKSConditionalGet(t *testing.T) {
	s := &Server{TokenIssuer: testIssuer(t)}

	fetch := func(ifNoneMatch string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil)
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		rec := httptest.NewRecorder()
		s.ServeJWKS(rec, req)
		return rec
	}

	first := fetch("")
	etag := first.Result().Header.Get("ETag")
	if etag == "" {
		t.Fatal("expected ETag header")
	}
	if first.Code != http.StatusOK || first.Body.Len() == 0 {
		t.Fatalf("status = %d, body = %d bytes", first.Code, first.Body.Len())
	}

	// Same key set: the polling verifier gets no body at all.
	for _, validator := range []string{etag, "W/" + etag, `"stale", ` + etag, "*"} {
		rec := fetch(validator)
		if rec.Code != http.StatusNotModified {
			t.Errorf("If-None-Match %q: status = %d, want 304", validator, rec.Code)
		}
		if rec.Body.Len() != 0 {
			t.Errorf("If-None-Match %q: 304 carried %d bytes", validator, rec.Body.Len())
		}
	}

	// A stale validator still gets the keys.
	if rec := fetch(`"stale"`); rec.Code != http.StatusOK || rec.Body.Len() == 0 {
		t.Errorf("stale validator: status = %d, body = %d bytes", rec.Code, rec.Body.Len())
	}
}

func TestServeJWKSEtagChangesWithKeySet(t *testing.T) {
	jwksEtag := func(s *Server) string {
		t.Helper()
		rec := httptest.NewRecorder()
		s.ServeJWKS(rec, httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil))
		return rec.Result().Header.Get("ETag")
	}

	before := jwksEtag(&Server{TokenIssuer: testIssuer(t)})
	after := jwksEtag(&Server{TokenIssuer: testIssuer(t)})
	if before == "" || after == "" {
		t.Fatal("expected ETag headers")
	}
	if before == after {
		t.Errorf("ETag did not change with the published key set: %q", before)
	}
}
