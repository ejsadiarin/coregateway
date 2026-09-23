package token

import (
	"encoding/base64"
)

// JWK is the public half of one Ed25519 signing key (RFC 7517).
type JWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	Kid string `json:"kid"`
	X   string `json:"x"`
	Use string `json:"use"`
	Alg string `json:"alg"`
}

// JWKS is the JSON Web Key Set served at /.well-known/jwks.json.
type JWKS struct {
	Keys []JWK `json:"keys"`
}

// JWKS builds the public key set: current key first, then the previous
// key while a rotation is in progress. It carries no secrets.
func (i *Issuer) JWKS() JWKS {
	keys := make([]JWK, 0, len(i.Keys()))
	for _, k := range i.Keys() {
		keys = append(keys, JWK{
			Kty: "OKP",
			Crv: "Ed25519",
			Kid: k.KID,
			X:   base64.RawURLEncoding.EncodeToString(k.Public),
			Use: "sig",
			Alg: "EdDSA",
		})
	}
	return JWKS{Keys: keys}
}
