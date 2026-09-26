package server

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ejsadiarin/coregateway/internal/auth"
	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/ejsadiarin/coregateway/internal/services/corefinance"
	"github.com/ejsadiarin/coregateway/internal/token"
)

// memoryKeyQuerier is an in-memory api_keys store so the provision →
// proxy → exchange round-trip runs without a database.
type memoryKeyQuerier struct {
	db.Querier
	mu     sync.Mutex
	byHash map[string]db.CoregatewayApiKey
}

func (m *memoryKeyQuerier) CreateApiKey(_ context.Context, arg db.CreateApiKeyParams) (db.CoregatewayApiKey, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	scopes := arg.Scopes
	if scopes == nil {
		scopes = []string{}
	}
	row := db.CoregatewayApiKey{
		ID:          uuid.New(),
		KeyPrefix:   arg.KeyPrefix,
		KeyHash:     arg.KeyHash,
		Label:       arg.Label,
		OwnerUserID: arg.OwnerUserID,
		Scopes:      scopes,
		ExpiresAt:   arg.ExpiresAt,
		CreatedAt:   pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}
	if m.byHash == nil {
		m.byHash = map[string]db.CoregatewayApiKey{}
	}
	m.byHash[arg.KeyHash] = row
	return row, nil
}

func (m *memoryKeyQuerier) GetApiKeyByHash(_ context.Context, hash string) (db.CoregatewayApiKey, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.byHash[hash]
	if !ok {
		return db.CoregatewayApiKey{}, pgx.ErrNoRows
	}
	return row, nil
}

func (m *memoryKeyQuerier) TouchApiKeyLastUsed(_ context.Context, _ uuid.UUID) error {
	return nil
}

func servicePatternSetup(t *testing.T) (*Server, *fakeDownstream, *token.Issuer) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	iss, err := token.NewIssuer(
		token.Key{KID: "2026-09-a", Private: priv, Public: pub},
		nil, "https://gateway.internal", "corefinance", 300*time.Second,
	)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	fake := &fakeDownstream{}
	downstream := httptest.NewServer(fake)
	t.Cleanup(downstream.Close)

	keys := auth.NewKeysService(&memoryKeyQuerier{})
	s := &Server{
		TokenIssuer:       iss,
		KeysService:       keys,
		KeysHandler:       auth.NewKeysHandler(keys, iss),
		CorefinanceClient: corefinance.New(downstream.URL),
	}
	return s, fake, iss
}

func TestServiceKeyRouteGates(t *testing.T) {
	s, _, _ := servicePatternSetup(t)
	adminID := uuid.New()

	// Anonymous → 401.
	rec := httptest.NewRecorder()
	proxyRouter(s, "", uuid.Nil).ServeHTTP(rec,
		httptest.NewRequest(http.MethodPost, "/api/auth/keys/service", strings.NewReader(`{"label":"x"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: status = %d, want 401", rec.Code)
	}

	// Non-admin → 403.
	rec = httptest.NewRecorder()
	proxyRouter(s, auth.RoleUser, uuid.New()).ServeHTTP(rec,
		httptest.NewRequest(http.MethodPost, "/api/auth/keys/service", strings.NewReader(`{"label":"x"}`)))
	if rec.Code != http.StatusForbidden {
		t.Errorf("non-admin: status = %d, want 403", rec.Code)
	}

	// Admin with missing label → 400.
	rec = httptest.NewRecorder()
	proxyRouter(s, auth.RoleAdmin, adminID).ServeHTTP(rec,
		httptest.NewRequest(http.MethodPost, "/api/auth/keys/service", strings.NewReader(`{}`)))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("missing label: status = %d, want 400", rec.Code)
	}
}

// TestServiceKeyPatternB is the end-to-end proof for Pattern B: a provisioned
// ownerless key is rejected on the user-scoped proxy leg and accepted at the
// token exchange, yielding a service JWT with no sub and azp = key label.
func TestServiceKeyPatternB(t *testing.T) {
	s, fake, iss := servicePatternSetup(t)
	adminH := proxyRouter(s, auth.RoleAdmin, uuid.New())
	anonH := proxyRouter(s, "", uuid.Nil)

	// 1. Provision an ownerless service key as admin.
	provision := httptest.NewRequest(http.MethodPost, "/api/auth/keys/service",
		strings.NewReader(`{"label":"svc-e2e","scopes":["finance:read"]}`))
	provision.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	adminH.ServeHTTP(rec, provision)
	if rec.Code != http.StatusCreated {
		t.Fatalf("provision: status = %d, want 201", rec.Code)
	}
	var created struct {
		ID        uuid.UUID `json:"id"`
		Key       string    `json:"key"`
		KeyPrefix string    `json:"key_prefix"`
		Label     string    `json:"label"`
		Scopes    []string  `json:"scopes"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("decode provision: %v", err)
	}
	if created.ID == uuid.Nil || created.Key == "" || created.Label != "svc-e2e" {
		t.Fatalf("provision response = %+v", created)
	}
	if !strings.HasPrefix(created.Key, auth.ApiKeyPrefix) {
		t.Fatalf("provisioned key %q missing prefix", created.Key)
	}

	// 2. The ownerless key as Bearer on the proxy leg → 401, never proxied.
	budgetReq := httptest.NewRequest(http.MethodGet, "/api/budget/remaining", nil)
	budgetReq.Header.Set("Authorization", "Bearer "+created.Key)
	budgetRec := httptest.NewRecorder()
	anonH.ServeHTTP(budgetRec, budgetReq)
	if budgetRec.Code != http.StatusUnauthorized {
		t.Fatalf("proxy with service key: status = %d, want 401", budgetRec.Code)
	}
	if hits, _, _, _ := fake.snapshot(); hits != 0 {
		t.Fatal("service-key proxy request must not reach downstream")
	}

	// 3. The same key at the exchange → service JWT with no sub, azp = label.
	exchangeBody, _ := json.Marshal(map[string]string{"key": created.Key})
	exchangeReq := httptest.NewRequest(http.MethodPost, "/api/auth/token", strings.NewReader(string(exchangeBody)))
	exchangeReq.Header.Set("Content-Type", "application/json")
	exchangeRec := httptest.NewRecorder()
	anonH.ServeHTTP(exchangeRec, exchangeReq)
	if exchangeRec.Code != http.StatusOK {
		t.Fatalf("exchange: status = %d, want 200", exchangeRec.Code)
	}
	var exchanged struct {
		TokenType string `json:"token_type"`
		Token     string `json:"token"`
	}
	if err := json.NewDecoder(exchangeRec.Body).Decode(&exchanged); err != nil {
		t.Fatalf("decode exchange: %v", err)
	}
	if exchanged.Token == "" {
		t.Fatal("exchange response missing token")
	}
	var claims token.Claims
	parsed, err := jwt.ParseWithClaims(exchanged.Token, &claims, func(t *jwt.Token) (any, error) {
		return iss.Keys()[0].Public, nil
	})
	if err != nil || !parsed.Valid {
		t.Fatalf("exchanged token does not verify: %v", err)
	}
	if claims.Subject != "" {
		t.Errorf("service token sub = %q, want empty", claims.Subject)
	}
	if claims.Azp != "svc-e2e" {
		t.Errorf("azp = %q, want svc-e2e", claims.Azp)
	}
}
