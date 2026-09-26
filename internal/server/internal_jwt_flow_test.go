package server

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/token"
)

// NOTE on scope: the strongest feasible automated test for the
// gateway-mints → downstream-verifies seam lives here, on the gateway side.
//
// A test wiring the real corefinance verifier
// (services/corefinance/internal/auth) against the real gateway issuer is
// impossible without module surgery: Go's internal rule rejects both
// directions, verified with `go vet`:
//
//	gateway test importing corefinance verifier:
//	  "use of internal package github.com/ejsadiarin/corefinance/internal/auth not allowed"
//	corefinance test importing gateway issuer:
//	  "use of internal package github.com/ejsadiarin/coregateway/internal/token not allowed"
//
// The go.work workspace does not lift the internal rule, and moving either
// package out of internal/ would be a non-test production change. A
// testcontainers approach adds nothing here either: the existing
// testcontainers pattern in this repo (internal/auth/keys_integration_test.go)
// provisions postgres for DB tests, while the verifier only needs JWKS over
// HTTP — plain httptest servers already give a real HTTP fetch without
// docker flakiness.
//
// So this file is the closest valuable test: real token.Issuer minting
// (via the real EdgeIdentity proxy leg and the real token-exchange handler),
// the real ServeJWKS handler served over real HTTP, and verification with
// the exact option set the downstream verifier uses (EdDSA + kid lookup +
// iss/aud + exp-required + 60s leeway). It covers what the gateway owns:
//   - minted user tokens verify against the served JWKS document (sub, azp,
//     iss, aud, exp-TTL, kid, alg) — edge-hygiene: no X-User-ID, no Cookie
//   - minted service tokens verify with no sub and azp = key label
//     (service-key-provisioning Pattern B shape)
//   - rotation overlap: prev-kid tokens still verify while both kids are
//     published (vault-rotation two-phase, jwks-resilience rotation)
//   - forged-kid and wrong iss/aud tokens are rejected
//
// The verifier-owned behaviors — negative-kid cache, singleflight fetch
// coalescing, stale-cache/rotation refresh, fail-closed boot — are covered
// against real gateway-minted tokens in mirror_verifier_flow_test.go, via a
// test-only copy of the downstream verifier (downstream_verifier_mirror_test.go;
// downstream repos are never imported, see the drift contract there).

// flowIssuer is the issuer identity shared by the tests below; it matches
// the defaults the verifier is configured with (see docs/auth-flow.md).
const (
	flowIssuer   = "https://gateway.internal"
	flowAudience = "corefinance"
	flowTTL      = 300 * time.Second
	// flowLeeway mirrors clockSkewLeeway in the downstream verifier.
	flowLeeway = 60 * time.Second
)

// serveFlowJWKS serves the real ServeJWKS handler for iss over real HTTP,
// the way a downstream fetches the gateway JWKS.
func serveFlowJWKS(t *testing.T, iss *token.Issuer) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc((&Server{TokenIssuer: iss}).ServeJWKS))
	t.Cleanup(srv.Close)
	return srv
}

// fetchFlowJWKSKeys fetches the JWKS document over HTTP and parses it the
// way the downstream verifier does: only OKP/Ed25519 entries with a kid and
// a 32-byte base64url public half are usable.
func fetchFlowJWKSKeys(t *testing.T, jwksURL string) map[string]ed25519.PublicKey {
	t.Helper()
	resp, err := http.Get(jwksURL)
	if err != nil {
		t.Fatalf("fetch jwks: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("jwks status = %d, want 200", resp.StatusCode)
	}
	var doc struct {
		Keys []struct {
			Kty string `json:"kty"`
			Crv string `json:"crv"`
			Kid string `json:"kid"`
			X   string `json:"x"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		t.Fatalf("decode jwks: %v", err)
	}
	keys := make(map[string]ed25519.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "OKP" || k.Crv != "Ed25519" || k.Kid == "" {
			continue
		}
		raw, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil || len(raw) != ed25519.PublicKeySize {
			continue
		}
		keys[k.Kid] = ed25519.PublicKey(raw)
	}
	if len(keys) == 0 {
		t.Fatal("jwks contains no usable Ed25519 keys")
	}
	return keys
}

// tryVerifyFlowToken verifies tokenString with the downstream verifier's
// option set: EdDSA only, kid-selected key, expected iss/aud, exp required,
// 60s leeway.
func tryVerifyFlowToken(tokenString string, keys map[string]ed25519.PublicKey, issuer, audience string) (token.Claims, error) {
	var claims token.Claims
	parsed, err := jwt.ParseWithClaims(tokenString, &claims,
		func(t *jwt.Token) (any, error) {
			if t.Method.Alg() != jwt.SigningMethodEdDSA.Alg() {
				return nil, jwt.ErrTokenSignatureInvalid
			}
			kid, _ := t.Header["kid"].(string)
			if kid == "" {
				return nil, jwt.ErrTokenUnverifiable
			}
			key, ok := keys[kid]
			if !ok {
				return nil, jwt.ErrTokenUnverifiable
			}
			return key, nil
		},
		jwt.WithIssuer(issuer),
		jwt.WithAudience(audience),
		jwt.WithLeeway(flowLeeway),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return token.Claims{}, err
	}
	if !parsed.Valid {
		return token.Claims{}, jwt.ErrTokenUnverifiable
	}
	return claims, nil
}

func verifyFlowToken(t *testing.T, tokenString string, keys map[string]ed25519.PublicKey) token.Claims {
	t.Helper()
	claims, err := tryVerifyFlowToken(tokenString, keys, flowIssuer, flowAudience)
	if err != nil {
		t.Fatalf("token does not verify against fetched JWKS: %v", err)
	}
	return claims
}

// TestInternalJWTFlowUserTokenVerifiesViaJWKS is the end-to-end proof for the
// session leg: the real EdgeIdentity proxy path mints a token that verifies
// against the real JWKS document fetched over HTTP, with full claim checks.
func TestInternalJWTFlowUserTokenVerifiesViaJWKS(t *testing.T) {
	s, fake, iss := proxyTestSetup(t)
	userID := uuid.New()

	req := httptest.NewRequest(http.MethodGet, "/api/budget/expenses/", nil)
	req.Header.Set("Cookie", "session=abc123")
	req.Header.Set("X-User-ID", uuid.New().String())
	rec := httptest.NewRecorder()
	proxyRouter(s, auth.RoleUser, userID).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	hits, _, authHeader, userIDHeader := fake.snapshot()
	if hits != 1 {
		t.Fatalf("downstream hits = %d, want 1", hits)
	}
	if userIDHeader != "" {
		t.Fatalf("downstream X-User-ID = %q, must be absent", userIDHeader)
	}
	if got := fake.cookie(); got != "" {
		t.Fatalf("downstream Cookie = %q, must be stripped", got)
	}

	keys := fetchFlowJWKSKeys(t, serveFlowJWKS(t, iss).URL)
	if len(keys) != 1 {
		t.Fatalf("jwks keys = %d, want 1", len(keys))
	}
	presented := strings.TrimPrefix(authHeader, "Bearer ")
	if presented == authHeader {
		t.Fatalf("downstream Authorization is not bearer: %q", authHeader)
	}
	claims := verifyFlowToken(t, presented, keys)

	if claims.Subject != userID.String() {
		t.Errorf("sub = %q, want %q", claims.Subject, userID.String())
	}
	if claims.Azp != "session" {
		t.Errorf("azp = %q, want session", claims.Azp)
	}
	if claims.Issuer != flowIssuer {
		t.Errorf("iss = %q, want %q", claims.Issuer, flowIssuer)
	}
	if len(claims.Audience) != 1 || claims.Audience[0] != flowAudience {
		t.Errorf("aud = %v, want [%s]", claims.Audience, flowAudience)
	}
	if claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time) != flowTTL {
		t.Errorf("exp-iat = %v, want %v", claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time), flowTTL)
	}
	unverified, _, err := jwt.NewParser().ParseUnverified(presented, &token.Claims{})
	if err != nil {
		t.Fatalf("parse unverified: %v", err)
	}
	if unverified.Header["kid"] != "2026-09-a" {
		t.Errorf("kid = %v, want 2026-09-a", unverified.Header["kid"])
	}
	if unverified.Header["alg"] != "EdDSA" {
		t.Errorf("alg = %v, want EdDSA", unverified.Header["alg"])
	}
}

// TestInternalJWTFlowServiceTokenVerifiesViaJWKS proves the Pattern B shape
// against the served JWKS: a provisioned ownerless key exchanged at
// POST /api/auth/token yields a service JWT with no sub and azp = label
// that verifies via HTTP-fetched JWKS.
func TestInternalJWTFlowServiceTokenVerifiesViaJWKS(t *testing.T) {
	s, _, iss := servicePatternSetup(t)
	adminH := proxyRouter(s, auth.RoleAdmin, uuid.New())
	anonH := proxyRouter(s, "", uuid.Nil)

	provision := httptest.NewRequest(http.MethodPost, "/api/auth/keys/service",
		strings.NewReader(`{"label":"svc-jwks-e2e","scopes":["finance:read"]}`))
	provision.Header.Set("Content-Type", "application/json")
	provisionRec := httptest.NewRecorder()
	adminH.ServeHTTP(provisionRec, provision)
	if provisionRec.Code != http.StatusCreated {
		t.Fatalf("provision: status = %d, want 201", provisionRec.Code)
	}
	var created struct {
		Key   string `json:"key"`
		Label string `json:"label"`
	}
	if err := json.NewDecoder(provisionRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode provision: %v", err)
	}

	exchangeBody, _ := json.Marshal(map[string]string{"key": created.Key})
	exchangeReq := httptest.NewRequest(http.MethodPost, "/api/auth/token", strings.NewReader(string(exchangeBody)))
	exchangeReq.Header.Set("Content-Type", "application/json")
	exchangeRec := httptest.NewRecorder()
	anonH.ServeHTTP(exchangeRec, exchangeReq)
	if exchangeRec.Code != http.StatusOK {
		t.Fatalf("exchange: status = %d, want 200", exchangeRec.Code)
	}
	var exchanged struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(exchangeRec.Body).Decode(&exchanged); err != nil {
		t.Fatalf("decode exchange: %v", err)
	}

	keys := fetchFlowJWKSKeys(t, serveFlowJWKS(t, iss).URL)
	claims := verifyFlowToken(t, exchanged.Token, keys)
	if claims.Subject != "" {
		t.Errorf("service token sub = %q, want empty", claims.Subject)
	}
	if claims.Azp != "svc-jwks-e2e" {
		t.Errorf("azp = %q, want svc-jwks-e2e", claims.Azp)
	}
	if claims.Scope != "finance:read" {
		t.Errorf("scope = %q, want finance:read", claims.Scope)
	}
}

// TestInternalJWTFlowRotationPrevKidStillVerifies covers the rotation overlap:
// a token minted before rotation (kid A) still verifies once the gateway
// publishes both kids, and a fresh token carries the new kid. This is the
// gateway half of the jwks-resilience "Rotation still propagates" scenario
// and the vault-rotation two-phase JWKS shape.
func TestInternalJWTFlowRotationPrevKidStillVerifies(t *testing.T) {
	oldPub, oldPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate old key: %v", err)
	}
	newPub, newPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate new key: %v", err)
	}
	oldKey := token.Key{KID: "2026-09-a", Private: oldPriv, Public: oldPub}
	newKey := token.Key{KID: "2026-09-b", Private: newPriv, Public: newPub}

	before, err := token.NewIssuer(oldKey, nil, flowIssuer, flowAudience, flowTTL)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	preRotation, err := before.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("create pre-rotation token: %v", err)
	}

	after, err := token.NewIssuer(newKey, &oldKey, flowIssuer, flowAudience, flowTTL)
	if err != nil {
		t.Fatalf("new rotated issuer: %v", err)
	}
	keys := fetchFlowJWKSKeys(t, serveFlowJWKS(t, after).URL)
	if len(keys) != 2 {
		t.Fatalf("jwks keys = %d, want 2 during rotation overlap", len(keys))
	}
	set := after.JWKS()
	if len(set.Keys) != 2 || set.Keys[0].Kid != "2026-09-b" || set.Keys[1].Kid != "2026-09-a" {
		t.Fatalf("jwks order = %+v, want current first", set.Keys)
	}

	if _, err := tryVerifyFlowToken(preRotation, keys, flowIssuer, flowAudience); err != nil {
		t.Errorf("pre-rotation token must verify during overlap: %v", err)
	}

	fresh, err := after.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("create post-rotation token: %v", err)
	}
	verifyFlowToken(t, fresh, keys)
	unverified, _, err := jwt.NewParser().ParseUnverified(fresh, &token.Claims{})
	if err != nil {
		t.Fatalf("parse unverified: %v", err)
	}
	if unverified.Header["kid"] != "2026-09-b" {
		t.Errorf("kid = %v, want 2026-09-b", unverified.Header["kid"])
	}
}

// TestInternalJWTFlowForgedKidRejected covers the reject half: a token whose
// kid is absent from the served JWKS (forgery/mis-issue) fails verification,
// as do tokens presented with the wrong issuer or audience.
func TestInternalJWTFlowForgedKidRejected(t *testing.T) {
	_, _, iss := proxyTestSetup(t)
	keys := fetchFlowJWKSKeys(t, serveFlowJWKS(t, iss).URL)

	_, forgedPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate forged key: %v", err)
	}
	now := time.Now()
	forgedClaims := token.Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    flowIssuer,
			Audience:  jwt.ClaimStrings{flowAudience},
			Subject:   uuid.New().String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(flowTTL)),
		},
		Azp: "session",
	}
	forgedTok := jwt.NewWithClaims(jwt.SigningMethodEdDSA, forgedClaims)
	forgedTok.Header["kid"] = "forged-kid"
	forged, err := forgedTok.SignedString(forgedPriv)
	if err != nil {
		t.Fatalf("sign forged token: %v", err)
	}
	if _, err := tryVerifyFlowToken(forged, keys, flowIssuer, flowAudience); err == nil {
		t.Error("forged-kid token verified, want rejection")
	}

	valid, err := iss.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	if _, err := tryVerifyFlowToken(valid, keys, "https://evil.example", flowAudience); err == nil {
		t.Error("wrong-issuer token verified, want rejection")
	}
	if _, err := tryVerifyFlowToken(valid, keys, flowIssuer, "other-service"); err == nil {
		t.Error("wrong-audience token verified, want rejection")
	}
}
