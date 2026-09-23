// Package token creates the gateway's short-lived internal JWTs.
//
// The gateway is the sole signer in the system. Tokens are created
// in-memory per request, forwarded as `Authorization: Bearer`, and never
// persisted. Downstream services verify them against the gateway JWKS.
package token

import (
	"crypto/ed25519"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Claims is the internal JWT envelope. Scope is a space-delimited list
// (OAuth2 style) and is omitted when empty. Subject is omitted for
// service tokens, which carry no user identity.
type Claims struct {
	jwt.RegisteredClaims
	Azp   string `json:"azp"`
	Scope string `json:"scope,omitempty"`
}

// Key is one Ed25519 signing key with its public identifier.
type Key struct {
	KID     string
	Private ed25519.PrivateKey
	Public  ed25519.PublicKey
}

// ParseKey parses a PKCS8 PEM-encoded Ed25519 private key
// (e.g. `openssl genpkey -algorithm ed25519`). Literal "\n" sequences
// are expanded so the PEM can travel in a single-line env var.
func ParseKey(kid, pem string) (Key, error) {
	if kid == "" {
		return Key{}, fmt.Errorf("token: kid is required")
	}
	normalized := strings.ReplaceAll(pem, "\\n", "\n")
	priv, err := jwt.ParseEdPrivateKeyFromPEM([]byte(normalized))
	if err != nil {
		return Key{}, fmt.Errorf("token: parse private key (kid %s): %w", kid, err)
	}
	edPriv, ok := priv.(ed25519.PrivateKey)
	if !ok {
		return Key{}, fmt.Errorf("token: key (kid %s) is not Ed25519", kid)
	}
	pub, ok := edPriv.Public().(ed25519.PublicKey)
	if !ok {
		return Key{}, fmt.Errorf("token: cannot derive Ed25519 public key (kid %s)", kid)
	}
	return Key{KID: kid, Private: edPriv, Public: pub}, nil
}

// Issuer creates signed internal JWTs. previous is nil outside rotation;
// when set, both keys are published in JWKS but only current signs.
type Issuer struct {
	current  Key
	previous *Key
	issuer   string
	audience string
	ttl      time.Duration
}

// NewIssuer builds an Issuer from parsed keys. current must be a valid
// key; previous may be nil.
func NewIssuer(current Key, previous *Key, issuer, audience string, ttl time.Duration) (*Issuer, error) {
	if current.KID == "" || len(current.Private) == 0 {
		return nil, fmt.Errorf("token: current signing key is required")
	}
	if previous != nil && (previous.KID == "" || len(previous.Private) == 0) {
		return nil, fmt.Errorf("token: previous signing key is incomplete")
	}
	if issuer == "" {
		return nil, fmt.Errorf("token: issuer is required")
	}
	if audience == "" {
		return nil, fmt.Errorf("token: audience is required")
	}
	if ttl <= 0 {
		return nil, fmt.Errorf("token: ttl must be positive")
	}
	return &Issuer{
		current:  current,
		previous: previous,
		issuer:   issuer,
		audience: audience,
		ttl:      ttl,
	}, nil
}

// NewIssuerFromPEM parses PEM material and builds an Issuer in one step.
// prevPEM/prevKID may both be empty (no rotation in progress).
func NewIssuerFromPEM(pem, kid, prevPEM, prevKID, issuer, audience string, ttl time.Duration) (*Issuer, error) {
	current, err := ParseKey(kid, pem)
	if err != nil {
		return nil, err
	}
	var previous *Key
	if prevPEM != "" {
		p, err := ParseKey(prevKID, prevPEM)
		if err != nil {
			return nil, err
		}
		previous = &p
	}
	return NewIssuer(current, previous, issuer, audience, ttl)
}

// TTL returns the token lifetime configured on the issuer.
func (i *Issuer) TTL() time.Duration {
	return i.ttl
}

// Keys returns the signing keys: current first, then previous when a
// rotation is in progress. Used to build the JWKS.
func (i *Issuer) Keys() []Key {
	keys := []Key{i.current}
	if i.previous != nil {
		keys = append(keys, *i.previous)
	}
	return keys
}

func (i *Issuer) sign(sub uuid.UUID, hasSub bool, azp string, scopes []string) (string, error) {
	now := time.Now()
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    i.issuer,
			Audience:  jwt.ClaimStrings{i.audience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(i.ttl)),
		},
		Azp: azp,
	}
	if hasSub {
		claims.Subject = sub.String()
	}
	if len(scopes) > 0 {
		claims.Scope = strings.Join(scopes, " ")
	}
	t := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	t.Header["kid"] = i.current.KID
	return t.SignedString(i.current.Private)
}

// CreateUserToken creates a token for a user identity established at the
// edge (azp "session" or "api-key:<id>").
func (i *Issuer) CreateUserToken(userID uuid.UUID, azp string, scopes []string) (string, error) {
	if userID == uuid.Nil {
		return "", fmt.Errorf("token: user id is required")
	}
	if azp == "" {
		return "", fmt.Errorf("token: azp is required")
	}
	return i.sign(userID, true, azp, scopes)
}

// CreateServiceToken creates a token for a service identity (no user).
// The label is typically the service name from its API key row.
func (i *Issuer) CreateServiceToken(label string, scopes []string) (string, error) {
	if label == "" {
		return "", fmt.Errorf("token: service label is required")
	}
	return i.sign(uuid.Nil, false, label, scopes)
}
