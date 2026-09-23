package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/ejsadiarin/coregateway/internal/token"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestGenerateAPIKeyFormat(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 10; i++ {
		plaintext, hash, err := GenerateAPIKey()
		if err != nil {
			t.Fatalf("generate: %v", err)
		}
		if !strings.HasPrefix(plaintext, ApiKeyPrefix) {
			t.Errorf("plaintext %q missing prefix", plaintext)
		}
		if seen[plaintext] {
			t.Error("duplicate key generated")
		}
		seen[plaintext] = true
		if len(hash) != 64 {
			t.Errorf("hash length = %d, want 64", len(hash))
		}
		sum := sha256.Sum256([]byte(plaintext))
		if hash != hex.EncodeToString(sum[:]) {
			t.Error("stored hash is not sha256(plaintext)")
		}
		if strings.Contains(hash, plaintext) {
			t.Error("hash must not embed plaintext")
		}
	}
}

// stubQuerier embeds the interface so only exercised methods need overrides.
type stubQuerier struct {
	db.Querier
	mu      sync.Mutex
	row     db.CoregatewayApiKey
	err     error
	touched []uuid.UUID
	revoked int64
	revErr  error
}

func (s *stubQuerier) GetApiKeyByHash(_ context.Context, _ string) (db.CoregatewayApiKey, error) {
	if s.err != nil {
		return db.CoregatewayApiKey{}, s.err
	}
	return s.row, nil
}

func (s *stubQuerier) TouchApiKeyLastUsed(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touched = append(s.touched, id)
	return nil
}

func (s *stubQuerier) RevokeApiKey(_ context.Context, _ uuid.UUID) (int64, error) {
	return s.revoked, s.revErr
}

func liveRow(owner uuid.UUID) db.CoregatewayApiKey {
	return db.CoregatewayApiKey{
		ID:     uuid.New(),
		Label:  "test",
		Scopes: []string{"finance:read"},
		OwnerUserID: pgtype.UUID{
			Bytes: owner,
			Valid: true,
		},
	}
}

func TestValidateKeyLive(t *testing.T) {
	owner := uuid.New()
	stub := &stubQuerier{row: liveRow(owner)}
	svc := NewKeysService(stub)

	userID, keyID, scopes, err := svc.ValidateKey(context.Background(), ApiKeyPrefix+"presented")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if userID != owner {
		t.Errorf("user = %v, want %v", userID, owner)
	}
	if keyID != stub.row.ID.String() {
		t.Errorf("key id = %q", keyID)
	}
	if len(scopes) != 1 || scopes[0] != "finance:read" {
		t.Errorf("scopes = %v", scopes)
	}
	// last_used is touched asynchronously; poll briefly.
	deadline := time.Now().Add(2 * time.Second)
	for {
		stub.mu.Lock()
		n := len(stub.touched)
		stub.mu.Unlock()
		if n > 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(stub.touched) != 1 || stub.touched[0] != stub.row.ID {
		t.Errorf("touched = %v, want [%v]", stub.touched, stub.row.ID)
	}
}

func TestValidateKeyRejects(t *testing.T) {
	owner := uuid.New()
	past := time.Now().Add(-time.Hour)
	cases := map[string]db.CoregatewayApiKey{
		"revoked": {
			ID:        uuid.New(),
			RevokedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		},
		"expired": {
			ID:          uuid.New(),
			OwnerUserID: pgtype.UUID{Bytes: owner, Valid: true},
			ExpiresAt:   pgtype.Timestamptz{Time: past, Valid: true},
		},
	}
	for name, row := range cases {
		svc := NewKeysService(&stubQuerier{row: row})
		if _, _, _, err := svc.ValidateKey(context.Background(), "k"); err != ErrInvalidKey {
			t.Errorf("%s: err = %v, want ErrInvalidKey", name, err)
		}
	}
	svc := NewKeysService(&stubQuerier{err: pgx.ErrNoRows})
	if _, _, _, err := svc.ValidateKey(context.Background(), "k"); err != ErrInvalidKey {
		t.Errorf("unknown: err = %v, want ErrInvalidKey", err)
	}
}

func TestValidateKeyOwnerlessServiceKey(t *testing.T) {
	row := liveRow(uuid.New())
	row.OwnerUserID = pgtype.UUID{}
	svc := NewKeysService(&stubQuerier{row: row})
	userID, _, _, err := svc.ValidateKey(context.Background(), "k")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if userID != uuid.Nil {
		t.Errorf("ownerless key user = %v, want Nil", userID)
	}
}

func TestCreateKeyRequiresLabel(t *testing.T) {
	svc := NewKeysService(&stubQuerier{})
	if _, _, err := svc.CreateKey(context.Background(), CreateKeyRequest{}); err == nil {
		t.Error("expected error for empty label")
	}
}

func TestRevokeKeyNotFound(t *testing.T) {
	svc := NewKeysService(&stubQuerier{revoked: 0})
	if err := svc.RevokeKey(context.Background(), uuid.New()); err != ErrKeyNotFound {
		t.Errorf("err = %v, want ErrKeyNotFound", err)
	}
}

func testExchangeHandler(t *testing.T, row db.CoregatewayApiKey, err error) (*KeysHandler, *token.Issuer) {
	t.Helper()
	pub, priv, genErr := ed25519.GenerateKey(rand.Reader)
	if genErr != nil {
		t.Fatalf("generate key: %v", genErr)
	}
	iss, genErr := token.NewIssuer(
		token.Key{KID: "2026-09-a", Private: priv, Public: pub},
		nil, "https://gateway.internal", "corefinance", 300*time.Second,
	)
	if genErr != nil {
		t.Fatalf("new issuer: %v", genErr)
	}
	svc := NewKeysService(&stubQuerier{row: row, err: err})
	return NewKeysHandler(svc, iss), iss
}

func serviceRow() db.CoregatewayApiKey {
	return db.CoregatewayApiKey{
		ID:     uuid.New(),
		Label:  "corereminder",
		Scopes: []string{"finance:read"},
	}
}

func TestExchangeServiceKey(t *testing.T) {
	h, iss := testExchangeHandler(t, serviceRow(), nil)

	body := strings.NewReader(`{"key":"service-key-material"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/token", body)
	rec := httptest.NewRecorder()
	h.Exchange(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp struct {
		TokenType string `json:"token_type"`
		Token     string `json:"token"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.TokenType != "Bearer" || resp.ExpiresIn != 300 {
		t.Errorf("response = %+v", resp)
	}
	var claims token.Claims
	parsed, err := jwt.ParseWithClaims(resp.Token, &claims, func(t *jwt.Token) (any, error) {
		return iss.Keys()[0].Public, nil
	})
	if err != nil || !parsed.Valid {
		t.Fatalf("exchanged token does not verify: %v", err)
	}
	if claims.Subject != "" {
		t.Errorf("service token sub = %q, want empty", claims.Subject)
	}
	if claims.Azp != "corereminder" {
		t.Errorf("azp = %q", claims.Azp)
	}
	if claims.Scope != "finance:read" {
		t.Errorf("scope = %q", claims.Scope)
	}
}

func TestExchangeRejects(t *testing.T) {
	owned := serviceRow()
	owned.OwnerUserID = pgtype.UUID{Bytes: uuid.New(), Valid: true}

	cases := map[string]struct {
		row  db.CoregatewayApiKey
		err  error
		body string
		want int
	}{
		"unknown key":     {row: db.CoregatewayApiKey{}, err: pgx.ErrNoRows, body: `{"key":"x"}`, want: http.StatusUnauthorized},
		"owned human key": {row: owned, body: `{"key":"x"}`, want: http.StatusForbidden},
		"empty body":      {row: serviceRow(), body: `{}`, want: http.StatusBadRequest},
		"malformed body":  {row: serviceRow(), body: `not-json`, want: http.StatusBadRequest},
	}
	for name, c := range cases {
		h, _ := testExchangeHandler(t, c.row, c.err)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/token", strings.NewReader(c.body))
		rec := httptest.NewRecorder()
		h.Exchange(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s: status = %d, want %d", name, rec.Code, c.want)
		}
	}
}
