package token

import (
	"crypto/ed25519"
	"encoding/base64"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func TestJWKSContainsCurrentKey(t *testing.T) {
	iss := testIssuer(t)
	set := iss.JWKS()

	if len(set.Keys) != 1 {
		t.Fatalf("keys = %d, want 1", len(set.Keys))
	}
	jwk := set.Keys[0]
	if jwk.Kty != "OKP" || jwk.Crv != "Ed25519" || jwk.Use != "sig" || jwk.Alg != "EdDSA" {
		t.Errorf("unexpected jwk metadata: %+v", jwk)
	}
	if jwk.Kid != "2026-09-a" {
		t.Errorf("kid = %q", jwk.Kid)
	}
	raw, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil {
		t.Fatalf("x is not base64url: %v", err)
	}
	if len(raw) != ed25519.PublicKeySize {
		t.Fatalf("x decodes to %d bytes, want %d", len(raw), ed25519.PublicKeySize)
	}
	if !ed25519.PublicKey(raw).Equal(iss.current.Public) {
		t.Error("x does not match the signing public key")
	}
}

func TestRotationOverlap(t *testing.T) {
	oldKey := testKey(t, "2026-09-a")
	newKey := testKey(t, "2026-09-b")

	before, err := NewIssuer(oldKey, nil, "https://gateway.internal", "corefinance", 300*time.Second)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	tokenString, err := before.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("create token: %v", err)
	}

	// Rotation: new key signs, old key still published.
	after, err := NewIssuer(newKey, &oldKey, "https://gateway.internal", "corefinance", 300*time.Second)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	set := after.JWKS()
	if len(set.Keys) != 2 {
		t.Fatalf("keys = %d, want 2 during rotation", len(set.Keys))
	}
	if set.Keys[0].Kid != "2026-09-b" || set.Keys[1].Kid != "2026-09-a" {
		t.Errorf("key order = [%s %s], want current first", set.Keys[0].Kid, set.Keys[1].Kid)
	}

	// The pre-rotation token still verifies against the published set.
	byKid := map[string]ed25519.PublicKey{oldKey.KID: oldKey.Public, newKey.KID: newKey.Public}
	var claims Claims
	parsed, err := jwt.ParseWithClaims(tokenString, &claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		pub, ok := byKid[kid]
		if !ok {
			return nil, jwt.ErrTokenUnverifiable
		}
		return pub, nil
	})
	if err != nil || !parsed.Valid {
		t.Fatalf("pre-rotation token failed to verify during overlap: %v", err)
	}

	// A token created after rotation carries the new kid.
	fresh, err := after.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	unverified, _, err := jwt.NewParser().ParseUnverified(fresh, &Claims{})
	if err != nil {
		t.Fatalf("parse unverified: %v", err)
	}
	if unverified.Header["kid"] != "2026-09-b" {
		t.Errorf("kid = %v, want 2026-09-b", unverified.Header["kid"])
	}

	// After retirement (previous dropped), only the new key is published.
	retired, err := NewIssuer(newKey, nil, "https://gateway.internal", "corefinance", 300*time.Second)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	if len(retired.JWKS().Keys) != 1 {
		t.Errorf("keys after retirement = %d, want 1", len(retired.JWKS().Keys))
	}
}
