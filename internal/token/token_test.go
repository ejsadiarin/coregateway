package token

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func testKey(t *testing.T, kid string) Key {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return Key{KID: kid, Private: priv, Public: pub}
}

func testIssuer(t *testing.T) *Issuer {
	t.Helper()
	iss, err := NewIssuer(testKey(t, "2026-09-a"), nil, "https://gateway.internal", "corefinance", 300*time.Second)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	return iss
}

func parseWith(t *testing.T, tokenString string, key ed25519.PublicKey) Claims {
	t.Helper()
	var claims Claims
	parsed, err := jwt.ParseWithClaims(tokenString, &claims, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != jwt.SigningMethodEdDSA.Alg() {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return key, nil
	})
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}
	if !parsed.Valid {
		t.Fatal("parsed token is not valid")
	}
	return claims
}

func TestCreateUserTokenClaims(t *testing.T) {
	iss := testIssuer(t)
	userID := uuid.New()

	tokenString, err := iss.CreateUserToken(userID, "session", nil)
	if err != nil {
		t.Fatalf("create token: %v", err)
	}

	claims := parseWith(t, tokenString, iss.current.Public)

	if claims.Subject != userID.String() {
		t.Errorf("sub = %q, want %q", claims.Subject, userID.String())
	}
	if claims.Issuer != "https://gateway.internal" {
		t.Errorf("iss = %q", claims.Issuer)
	}
	if len(claims.Audience) != 1 || claims.Audience[0] != "corefinance" {
		t.Errorf("aud = %v", claims.Audience)
	}
	if claims.Azp != "session" {
		t.Errorf("azp = %q", claims.Azp)
	}
	if claims.Scope != "" {
		t.Errorf("scope should be omitted, got %q", claims.Scope)
	}
	if claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time) != 300*time.Second {
		t.Errorf("exp-iat = %v, want 300s", claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time))
	}

	parser := jwt.NewParser()
	unverified, _, err := parser.ParseUnverified(tokenString, &Claims{})
	if err != nil {
		t.Fatalf("parse unverified: %v", err)
	}
	if unverified.Header["kid"] != "2026-09-a" {
		t.Errorf("kid = %v", unverified.Header["kid"])
	}
	if unverified.Header["alg"] != "EdDSA" {
		t.Errorf("alg = %v", unverified.Header["alg"])
	}
}

func TestCreateUserTokenScopesJoined(t *testing.T) {
	iss := testIssuer(t)
	tokenString, err := iss.CreateUserToken(uuid.New(), "api-key:abc", []string{"finance:read", "finance:write"})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	claims := parseWith(t, tokenString, iss.current.Public)
	if claims.Scope != "finance:read finance:write" {
		t.Errorf("scope = %q", claims.Scope)
	}
	if claims.Azp != "api-key:abc" {
		t.Errorf("azp = %q", claims.Azp)
	}
}

func TestCreateServiceTokenHasNoSubject(t *testing.T) {
	iss := testIssuer(t)
	tokenString, err := iss.CreateServiceToken("corereminder", []string{"finance:read"})
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	if strings.Contains(tokenString, "sub") {
		// crude check that payload omits sub; verified structurally below
		t.Logf("note: raw token contains 'sub' substring (may be coincidental)")
	}
	claims := parseWith(t, tokenString, iss.current.Public)
	if claims.Subject != "" {
		t.Errorf("service token sub = %q, want empty", claims.Subject)
	}
	if claims.Azp != "corereminder" {
		t.Errorf("azp = %q", claims.Azp)
	}
}

func TestTamperedTokenRejected(t *testing.T) {
	iss := testIssuer(t)
	tokenString, err := iss.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	tampered := tokenString[:len(tokenString)-2] + "xx"
	var claims Claims
	_, err = jwt.ParseWithClaims(tampered, &claims, func(t *jwt.Token) (any, error) {
		return iss.current.Public, nil
	})
	if err == nil {
		t.Fatal("expected tampered token to fail verification")
	}
}

func TestWrongKeyRejected(t *testing.T) {
	iss := testIssuer(t)
	other := testKey(t, "other")
	tokenString, err := iss.CreateUserToken(uuid.New(), "session", nil)
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	var claims Claims
	_, err = jwt.ParseWithClaims(tokenString, &claims, func(t *jwt.Token) (any, error) {
		return other.Public, nil
	})
	if err == nil {
		t.Fatal("expected token verified with wrong key to fail")
	}
}

func TestParseKeyRoundTrip(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatalf("marshal pkcs8: %v", err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})

	// single-line env form with literal \n
	singleLine := strings.ReplaceAll(string(pemBytes), "\n", "\\n")
	key, err := ParseKey("2026-09-a", singleLine)
	if err != nil {
		t.Fatalf("parse key: %v", err)
	}
	if key.KID != "2026-09-a" {
		t.Errorf("kid = %q", key.KID)
	}
	if !key.Public.Equal(priv.Public()) {
		t.Error("public key mismatch after PEM round-trip")
	}
}

func TestParseKeyRejects(t *testing.T) {
	if _, err := ParseKey("", "whatever"); err == nil {
		t.Error("expected error for empty kid")
	}
	if _, err := ParseKey("a", "not-a-pem"); err == nil {
		t.Error("expected error for garbage PEM")
	}
	if _, err := ParseKey("a", ""); err == nil {
		t.Error("expected error for empty PEM")
	}
}

func TestNewIssuerValidation(t *testing.T) {
	key := testKey(t, "a")
	if _, err := NewIssuer(Key{}, nil, "iss", "aud", time.Minute); err == nil {
		t.Error("expected error for empty current key")
	}
	if _, err := NewIssuer(key, &Key{}, "iss", "aud", time.Minute); err == nil {
		t.Error("expected error for incomplete previous key")
	}
	if _, err := NewIssuer(key, nil, "", "aud", time.Minute); err == nil {
		t.Error("expected error for empty issuer")
	}
	if _, err := NewIssuer(key, nil, "iss", "", time.Minute); err == nil {
		t.Error("expected error for empty audience")
	}
	if _, err := NewIssuer(key, nil, "iss", "aud", 0); err == nil {
		t.Error("expected error for non-positive ttl")
	}
	if _, err := NewIssuerFromPEM("", "a", "", "", "iss", "aud", time.Minute); err == nil {
		t.Error("expected error for empty PEM")
	}
}
