package server

// DOWNSTREAM MIRROR — copy, not import.
//
// This file is a test-only copy of the downstream verifier at
// services/corefinance/internal/auth/verifier.go (submodule commit 426fb38).
// Downstream services are treated as separate repositories: Go's internal
// rule forbids importing their packages, and reaching across that boundary
// would couple the gateway test suite to another repo's layout. Duplicating
// this logic here is deliberate.
//
// Purpose: exercise the gateway-mints → downstream-verifies seam against
// verifier-identical behavior — singleflight fetch coalescing, the 30s
// negative-kid cache, stale-cache refresh, fail-closed boot, and the exact
// 401 body — using real gateway-minted tokens instead of synthetic ones.
//
// DRIFT CONTRACT: if the source verifier changes (options, TTLs, bodies,
// refresh logic), this copy MUST be updated by hand to match. The tests
// below assert the behaviors that matter; a drifted copy fails loudly.
//
// Adaptations from the source (verification behavior untouched):
//   - Claims: the source's local Claims type is identical in shape to the
//     gateway's token.Claims (RegisteredClaims + azp + scope), so token.Claims
//     is used directly.
//   - Context injection: the source writes corefinance context helpers
//     (WithUserID/WithScopes/WithService). This copy writes test-local keys
//     read back via mirrorIdentityFromContext; identity *establishment*
//     semantics (user vs service, sub parsing, scope splitting) are unchanged.

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/sync/singleflight"

	"github.com/ejsadiarin/coregateway/internal/token"
)

// mirrorClockSkewLeeway mirrors clockSkewLeeway in the source verifier.
const mirrorClockSkewLeeway = 60 * time.Second

// mirrorDefaultCacheTTL mirrors defaultCacheTTL in the source verifier.
const mirrorDefaultCacheTTL = 5 * time.Minute

// mirrorNegativeCacheTTL mirrors negativeCacheTTL in the source verifier.
const mirrorNegativeCacheTTL = 30 * time.Second

// mirrorIdentity is the test-local established identity, mirroring what the
// source verifier injects into the request context (user ID + scopes, or a
// service label + scopes for sub-less tokens).
type mirrorIdentity struct {
	userID uuid.UUID
	label  string
	scopes []string
}

type mirrorContextKey string

const mirrorIdentityKey mirrorContextKey = "mirror-identity"

func mirrorIdentityFromContext(ctx context.Context) (*mirrorIdentity, bool) {
	id, ok := ctx.Value(mirrorIdentityKey).(*mirrorIdentity)
	return id, ok
}

// mirrorConfig mirrors Config in the source verifier.
type mirrorConfig struct {
	Issuer      string
	Audience    string
	JWKSURL     string
	CacheTTL    time.Duration
	HTTPClient  *http.Client
	PublicPaths []string
}

// mirrorVerifier mirrors Verifier in the source verifier.
type mirrorVerifier struct {
	cfg       mirrorConfig
	mu        sync.RWMutex
	keys      map[string]ed25519.PublicKey
	fetchedAt time.Time
	public    map[string]bool
	negative  map[string]time.Time
	sf        singleflight.Group
}

// newMirrorVerifier mirrors NewVerifier: it performs the initial JWKS fetch
// and fails closed without keys.
func newMirrorVerifier(cfg mirrorConfig) (*mirrorVerifier, error) {
	if cfg.Issuer == "" {
		return nil, fmt.Errorf("auth: JWT issuer is required")
	}
	if cfg.Audience == "" {
		return nil, fmt.Errorf("auth: JWT audience is required")
	}
	if cfg.JWKSURL == "" {
		return nil, fmt.Errorf("auth: JWKS URL is required")
	}
	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = mirrorDefaultCacheTTL
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 10 * time.Second}
	}
	v := &mirrorVerifier{
		cfg:      cfg,
		keys:     map[string]ed25519.PublicKey{},
		public:   map[string]bool{},
		negative: map[string]time.Time{},
	}
	for _, p := range cfg.PublicPaths {
		v.public[p] = true
	}
	if err := v.refresh(); err != nil {
		return nil, fmt.Errorf("auth: initial JWKS fetch: %w", err)
	}
	return v, nil
}

type mirrorJWKSDocument struct {
	Keys []struct {
		Kty string `json:"kty"`
		Crv string `json:"crv"`
		Kid string `json:"kid"`
		X   string `json:"x"`
		Use string `json:"use"`
		Alg string `json:"alg"`
	} `json:"keys"`
}

func (v *mirrorVerifier) fetch() (map[string]ed25519.PublicKey, error) {
	resp, err := v.cfg.HTTPClient.Get(v.cfg.JWKSURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("JWKS status %d", resp.StatusCode)
	}
	var doc mirrorJWKSDocument
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return nil, err
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
		return nil, fmt.Errorf("JWKS contains no usable Ed25519 keys")
	}
	return keys, nil
}

func (v *mirrorVerifier) refresh() error {
	keys, err := v.fetch()
	if err != nil {
		return err
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	v.keys = keys
	v.fetchedAt = time.Now()
	return nil
}

func (v *mirrorVerifier) keyFor(kid string) (ed25519.PublicKey, bool) {
	v.mu.RLock()
	key, ok := v.keys[kid]
	fresh := time.Since(v.fetchedAt) < v.cfg.CacheTTL
	if ok && fresh {
		v.mu.RUnlock()
		return key, true
	}
	if until, neg := v.negative[kid]; neg && time.Now().Before(until) {
		v.mu.RUnlock()
		return nil, false
	}
	v.mu.RUnlock()

	_, err, _ := v.sf.Do("jwks-refresh", func() (any, error) {
		return nil, v.refresh()
	})
	if err != nil {
		return nil, false
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	key, ok = v.keys[kid]
	if !ok {
		now := time.Now()
		for k, until := range v.negative {
			if !now.Before(until) {
				delete(v.negative, k)
			}
		}
		v.negative[kid] = now.Add(mirrorNegativeCacheTTL)
		return nil, false
	}
	delete(v.negative, kid)
	return key, true
}

// middleware mirrors Verifier.Middleware: same X-User-ID strip, same public
// paths, same bearer parsing, same jwt parse options, same user-vs-service
// split, same byte-identical 401 body.
func (v *mirrorVerifier) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Del("X-User-ID")

		if v.public[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}

		presented, ok := mirrorBearerToken(r)
		if !ok {
			mirrorUnauthorized(w)
			return
		}

		var claims token.Claims
		parsed, err := jwt.ParseWithClaims(presented, &claims,
			func(t *jwt.Token) (any, error) {
				if t.Method.Alg() != jwt.SigningMethodEdDSA.Alg() {
					return nil, jwt.ErrTokenSignatureInvalid
				}
				kid, _ := t.Header["kid"].(string)
				if kid == "" {
					return nil, jwt.ErrTokenUnverifiable
				}
				key, ok := v.keyFor(kid)
				if !ok {
					return nil, jwt.ErrTokenUnverifiable
				}
				return key, nil
			},
			jwt.WithIssuer(v.cfg.Issuer),
			jwt.WithAudience(v.cfg.Audience),
			jwt.WithLeeway(mirrorClockSkewLeeway),
			jwt.WithExpirationRequired(),
		)
		if err != nil || !parsed.Valid {
			mirrorUnauthorized(w)
			return
		}

		if claims.Subject != "" {
			userID, err := uuid.Parse(claims.Subject)
			if err != nil {
				mirrorUnauthorized(w)
				return
			}
			ctx := context.WithValue(r.Context(), mirrorIdentityKey, &mirrorIdentity{
				userID: userID,
				scopes: strings.Fields(claims.Scope),
			})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		ctx := context.WithValue(r.Context(), mirrorIdentityKey, &mirrorIdentity{
			label:  claims.Azp,
			scopes: strings.Fields(claims.Scope),
		})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func mirrorBearerToken(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	if h == "" {
		return "", false
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") || parts[1] == "" {
		return "", false
	}
	return parts[1], true
}

func mirrorUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"valid internal credentials are required"}`))
}
