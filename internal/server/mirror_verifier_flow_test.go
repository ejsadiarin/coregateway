package server

import (
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/ejsadiarin/coregateway/internal/token"
)

// mirrorHarness is a controllable stand-in for the downstream side: a JWKS
// endpoint with a fetch counter and a fail switch, fronting a swappable
// gateway issuer. All tokens in these tests are minted by the real gateway
// issuer; all verification goes through the mirror copy of the downstream
// verifier.
type mirrorHarness struct {
	t       *testing.T
	mu      sync.Mutex
	iss     *token.Issuer
	fetches atomic.Int64
	fail    atomic.Bool
	// delay widens the JWKS fetch window so concurrent verifications overlap
	// in flight (used by the singleflight test).
	delay time.Duration
	srv   *httptest.Server
}

func newMirrorHarness(t *testing.T, iss *token.Issuer) *mirrorHarness {
	t.Helper()
	h := &mirrorHarness{t: t, iss: iss}
	h.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.fetches.Add(1)
		if h.fail.Load() {
			http.Error(w, "jwks down", http.StatusInternalServerError)
			return
		}
		if d := h.delay; d > 0 {
			time.Sleep(d)
		}
		h.mu.Lock()
		iss := h.iss
		h.mu.Unlock()
		(&Server{TokenIssuer: iss}).ServeJWKS(w, r)
	}))
	t.Cleanup(h.srv.Close)
	return h
}

func (h *mirrorHarness) swapIssuer(iss *token.Issuer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.iss = iss
}

func (h *mirrorHarness) newVerifier(cacheTTL time.Duration) *mirrorVerifier {
	h.t.Helper()
	v, err := newMirrorVerifier(mirrorConfig{
		Issuer:   flowIssuer,
		Audience: flowAudience,
		JWKSURL:  h.srv.URL,
		CacheTTL: cacheTTL,
	})
	if err != nil {
		h.t.Fatalf("new mirror verifier: %v", err)
	}
	return v
}

func mirrorTestKey(t *testing.T, kid string) token.Key {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return token.Key{KID: kid, Private: priv, Public: pub}
}

func mirrorTestIssuer(t *testing.T, current token.Key, prev *token.Key) *token.Issuer {
	t.Helper()
	iss, err := token.NewIssuer(current, prev, flowIssuer, flowAudience, flowTTL)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	return iss
}

// mirrorRoundTrip sends tokenString through the mirror middleware and returns
// the status, response body, and established identity (nil when rejected).
func mirrorRoundTrip(v *mirrorVerifier, tokenString string, headers map[string]string) (int, string, *mirrorIdentity) {
	var got *mirrorIdentity
	ok := false
	h := v.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok = mirrorIdentityFromContext(r.Context())
		if r.Header.Get("X-User-ID") != "" {
			w.WriteHeader(http.StatusTeapot)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/budget/remaining", nil)
	if tokenString != "" {
		req.Header.Set("Authorization", "Bearer "+tokenString)
	}
	for k, val := range headers {
		req.Header.Set(k, val)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !ok {
		got = nil
	}
	return rec.Code, rec.Body.String(), got
}

// TestMirrorUserTokenEndToEnd proves the core seam: a real gateway-minted
// user token passes verifier-identical checks and establishes the user
// identity, with edge hygiene (forged X-User-ID stripped, never trusted).
func TestMirrorUserTokenEndToEnd(t *testing.T) {
	h := newMirrorHarness(t, mirrorTestIssuer(t, mirrorTestKey(t, "2026-09-a"), nil))
	v := h.newVerifier(0)
	if got := h.fetches.Load(); got != 1 {
		t.Fatalf("fetches after boot = %d, want 1 (initial fetch)", got)
	}

	userID := uuid.New()
	minted, err := h.iss.CreateUserToken(userID, "session", nil)
	if err != nil {
		t.Fatalf("mint user token: %v", err)
	}
	code, _, id := mirrorRoundTrip(v, minted, map[string]string{"X-User-ID": uuid.New().String()})
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if id == nil || id.userID != userID {
		t.Fatalf("identity = %+v, want user %s", id, userID)
	}
	if id.label != "" {
		t.Errorf("label = %q, want empty for user token", id.label)
	}
	if got := h.fetches.Load(); got != 1 {
		t.Errorf("fetches = %d, want 1 (fresh cache, no refresh)", got)
	}
}

// TestMirrorServiceTokenEndToEnd proves the Pattern B shape through
// verifier-identical checks: a sub-less token minted by the real issuer (the
// same call the exchange handler makes) establishes a service identity with
// the key label and scopes, and no user.
func TestMirrorServiceTokenEndToEnd(t *testing.T) {
	h := newMirrorHarness(t, mirrorTestIssuer(t, mirrorTestKey(t, "2026-09-a"), nil))
	v := h.newVerifier(0)

	minted, err := h.iss.CreateServiceToken("svc-mirror", []string{"finance:read"})
	if err != nil {
		t.Fatalf("mint service token: %v", err)
	}
	code, _, id := mirrorRoundTrip(v, minted, nil)
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if id == nil {
		t.Fatal("no identity established")
	}
	if id.userID != uuid.Nil {
		t.Errorf("userID = %s, want nil for service token", id.userID)
	}
	if id.label != "svc-mirror" {
		t.Errorf("label = %q, want svc-mirror", id.label)
	}
	if len(id.scopes) != 1 || id.scopes[0] != "finance:read" {
		t.Errorf("scopes = %v, want [finance:read]", id.scopes)
	}
}

// TestMirrorNegativeKidCachesForgedKid proves the forgery path against a real
// gateway issuer: a token signed by an unknown key with correct iss/aud gets
// the exact downstream 401, triggers one refresh, and is then rejected from
// the negative cache without further fetches — while valid tokens keep
// passing (no poisoning).
func TestMirrorNegativeKidCachesForgedKid(t *testing.T) {
	h := newMirrorHarness(t, mirrorTestIssuer(t, mirrorTestKey(t, "2026-09-a"), nil))
	v := h.newVerifier(0)

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
	_, forgedPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate forged key: %v", err)
	}
	forged, err := forgedTok.SignedString(forgedPriv)
	if err != nil {
		t.Fatalf("sign forged token: %v", err)
	}

	const wantBody = `{"error":"valid internal credentials are required"}`
	for i := 0; i < 2; i++ {
		code, body, id := mirrorRoundTrip(v, forged, nil)
		if code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status = %d, want 401", i, code)
		}
		if body != wantBody {
			t.Fatalf("attempt %d: body = %q, want %q", i, body, wantBody)
		}
		if id != nil {
			t.Fatalf("attempt %d: identity established for forged token", i)
		}
	}
	if got := h.fetches.Load(); got != 2 {
		t.Errorf("fetches = %d, want 2 (initial + one refresh; second rejection from negative cache)", got)
	}

	valid, err := h.iss.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("mint valid token: %v", err)
	}
	if code, _, _ := mirrorRoundTrip(v, valid, nil); code != http.StatusOK {
		t.Errorf("valid token status = %d after forgeries, want 200", code)
	}
	if got := h.fetches.Load(); got != 2 {
		t.Errorf("fetches = %d, want 2 (valid token must not trigger refresh)", got)
	}
}

// TestMirrorSingleflightCoalesces proves the herd path: with a stale cache,
// 20 concurrent verifications of real gateway-minted tokens collapse into a
// single JWKS refresh fetch.
func TestMirrorSingleflightCoalesces(t *testing.T) {
	h := newMirrorHarness(t, mirrorTestIssuer(t, mirrorTestKey(t, "2026-09-a"), nil))
	// 1ns TTL: the cache is stale for every request after boot, forcing the
	// refresh path without sleeps. The slow fetch keeps all 20 verifications
	// in flight together so singleflight must coalesce them.
	h.delay = 200 * time.Millisecond
	v := h.newVerifier(time.Nanosecond)

	minted, err := h.iss.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("mint user token: %v", err)
	}

	const n = 20
	var wg sync.WaitGroup
	codes := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			code, _, _ := mirrorRoundTrip(v, minted, nil)
			codes[i] = code
		}(i)
	}
	wg.Wait()
	for i, code := range codes {
		if code != http.StatusOK {
			t.Errorf("goroutine %d: status = %d, want 200", i, code)
		}
	}
	if got := h.fetches.Load(); got != 2 {
		t.Errorf("fetches = %d, want 2 (initial + one coalesced refresh)", got)
	}
}

// TestMirrorRotationPropagates proves the rotation path: a verifier holding
// only the pre-rotation key picks up the new kid via refresh and accepts a
// real gateway-minted post-rotation token, while pre-rotation tokens keep
// verifying during overlap.
func TestMirrorRotationPropagates(t *testing.T) {
	oldKey := mirrorTestKey(t, "2026-09-a")
	newKey := mirrorTestKey(t, "2026-09-b")
	before := mirrorTestIssuer(t, oldKey, nil)

	preRotation, err := before.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("mint pre-rotation token: %v", err)
	}

	h := newMirrorHarness(t, before)
	v := h.newVerifier(0)

	h.swapIssuer(mirrorTestIssuer(t, newKey, &oldKey))
	postRotation, err := h.iss.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("mint post-rotation token: %v", err)
	}

	if code, _, _ := mirrorRoundTrip(v, postRotation, nil); code != http.StatusOK {
		t.Fatalf("post-rotation token status = %d, want 200 after refresh", code)
	}
	if code, _, _ := mirrorRoundTrip(v, preRotation, nil); code != http.StatusOK {
		t.Errorf("pre-rotation token status = %d during overlap, want 200", code)
	}
	if got := h.fetches.Load(); got != 2 {
		t.Errorf("fetches = %d, want 2 (initial + one rotation refresh)", got)
	}
}

// TestMirrorFetchFailureRetries proves the outage path: a failed refresh is a
// 401 with nothing cached (no negative entry), so the next request retries
// and recovers without a restart.
func TestMirrorFetchFailureRetries(t *testing.T) {
	h := newMirrorHarness(t, mirrorTestIssuer(t, mirrorTestKey(t, "2026-09-a"), nil))

	minted, err := h.iss.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("mint user token: %v", err)
	}

	// Stale cache + failing JWKS: refresh fails, request is 401.
	stale := h.newVerifier(time.Nanosecond)
	h.fail.Store(true)
	if code, _, _ := mirrorRoundTrip(stale, minted, nil); code != http.StatusUnauthorized {
		t.Fatalf("outage status = %d, want 401", code)
	}

	// Recovery on the next request: no negative entry was written for the
	// failure, so it retries the fetch and verifies.
	h.fail.Store(false)
	if code, _, id := mirrorRoundTrip(stale, minted, nil); code != http.StatusOK || id == nil {
		t.Fatalf("recovery status = %d, want 200 with identity", code)
	}
}

// TestMirrorFailClosedBoot proves the source's fail-closed constructor: with
// JWKS unreachable at boot, no verifier is returned.
func TestMirrorFailClosedBoot(t *testing.T) {
	h := newMirrorHarness(t, mirrorTestIssuer(t, mirrorTestKey(t, "2026-09-a"), nil))
	h.fail.Store(true)
	if _, err := newMirrorVerifier(mirrorConfig{
		Issuer:   flowIssuer,
		Audience: flowAudience,
		JWKSURL:  h.srv.URL,
	}); err == nil {
		t.Fatal("expected boot error with JWKS down, got nil")
	}
}

// TestMirrorRejectsWrongIssuerAndAudience pins the iss/aud checks against
// real gateway-minted tokens: forging the expected audience/issuer (rather
// than the token) must reject.
func TestMirrorRejectsWrongIssuerAndAudience(t *testing.T) {
	h := newMirrorHarness(t, mirrorTestIssuer(t, mirrorTestKey(t, "2026-09-a"), nil))
	minted, err := h.iss.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("mint user token: %v", err)
	}

	evil, err := newMirrorVerifier(mirrorConfig{
		Issuer:   "https://evil.example",
		Audience: flowAudience,
		JWKSURL:  h.srv.URL,
	})
	if err != nil {
		t.Fatalf("new evil-issuer verifier: %v", err)
	}
	if code, _, _ := mirrorRoundTrip(evil, minted, nil); code != http.StatusUnauthorized {
		t.Errorf("wrong-issuer status = %d, want 401", code)
	}

	other, err := newMirrorVerifier(mirrorConfig{
		Issuer:   flowIssuer,
		Audience: "other-service",
		JWKSURL:  h.srv.URL,
	})
	if err != nil {
		t.Fatalf("new other-audience verifier: %v", err)
	}
	if code, _, _ := mirrorRoundTrip(other, minted, nil); code != http.StatusUnauthorized {
		t.Errorf("wrong-audience status = %d, want 401", code)
	}
}
