package auth

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

	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/ejsadiarin/coregateway/internal/token"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// serviceKeyStub is an in-memory Querier for service-key tests. It stores
// rows by hash so Create → Validate → Exchange round-trips work without a DB.
type serviceKeyStub struct {
	db.Querier
	mu        sync.Mutex
	byHash    map[string]db.CoregatewayApiKey
	createErr error
}

func newServiceKeyStub() *serviceKeyStub {
	return &serviceKeyStub{byHash: map[string]db.CoregatewayApiKey{}}
}

func (s *serviceKeyStub) CreateApiKey(_ context.Context, arg db.CreateApiKeyParams) (db.CoregatewayApiKey, error) {
	if s.createErr != nil {
		return db.CoregatewayApiKey{}, s.createErr
	}
	s.mu.Lock()
	defer s.mu.Unlock()
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
	if s.byHash == nil {
		s.byHash = map[string]db.CoregatewayApiKey{}
	}
	s.byHash[arg.KeyHash] = row
	return row, nil
}

func (s *serviceKeyStub) GetApiKeyByHash(_ context.Context, hash string) (db.CoregatewayApiKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	row, ok := s.byHash[hash]
	if !ok {
		return db.CoregatewayApiKey{}, pgx.ErrNoRows
	}
	return row, nil
}

func (s *serviceKeyStub) ListApiKeys(_ context.Context) ([]db.ListApiKeysRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]db.ListApiKeysRow, 0, len(s.byHash))
	for _, row := range s.byHash {
		out = append(out, db.ListApiKeysRow{
			ID:          row.ID,
			KeyPrefix:   row.KeyPrefix,
			Label:       row.Label,
			OwnerUserID: row.OwnerUserID,
			Scopes:      row.Scopes,
			ExpiresAt:   row.ExpiresAt,
			CreatedAt:   row.CreatedAt,
		})
	}
	return out, nil
}

func (s *serviceKeyStub) TouchApiKeyLastUsed(_ context.Context, _ uuid.UUID) error {
	return nil
}

func serviceTestIssuer(t *testing.T) *token.Issuer {
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
	return iss
}

func TestCreateServiceKeyOwnerless(t *testing.T) {
	stub := newServiceKeyStub()
	svc := NewKeysService(stub)

	plaintext, row, err := svc.CreateServiceKey(context.Background(), CreateServiceKeyRequest{
		Label:  "svc-a",
		Scopes: []string{"finance:read"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !strings.HasPrefix(plaintext, ApiKeyPrefix) {
		t.Errorf("plaintext %q missing prefix", plaintext)
	}
	if row.OwnerUserID.Valid {
		t.Errorf("owner_user_id valid = true, want NULL for service keys")
	}
	if row.KeyPrefix != ApiKeyPrefix {
		t.Errorf("key_prefix = %q, want %q", row.KeyPrefix, ApiKeyPrefix)
	}
	if row.KeyHash != HashAPIKey(plaintext) || len(row.KeyHash) != 64 {
		t.Error("stored hash is not sha256(plaintext)")
	}
	if strings.Contains(row.KeyHash, plaintext) {
		t.Error("hash must not embed plaintext")
	}
	if row.Label != "svc-a" {
		t.Errorf("label = %q, want svc-a", row.Label)
	}
	if len(row.Scopes) != 1 || row.Scopes[0] != "finance:read" {
		t.Errorf("scopes = %v", row.Scopes)
	}

	// The provisioned key validates as a service key and resolves no user.
	userID, keyID, _, err := svc.ValidateKey(context.Background(), plaintext)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if userID != uuid.Nil {
		t.Errorf("user = %v, want Nil", userID)
	}
	if keyID != row.ID.String() {
		t.Errorf("key id = %q, want %q", keyID, row.ID.String())
	}
	if _, err := svc.ValidateServiceKey(context.Background(), plaintext); err != nil {
		t.Fatalf("validate service: %v", err)
	}
}

func TestCreateServiceKeyRequiresLabel(t *testing.T) {
	svc := NewKeysService(newServiceKeyStub())
	for _, req := range []CreateServiceKeyRequest{{}, {Label: ""}, {Scopes: []string{"x"}}} {
		if _, _, err := svc.CreateServiceKey(context.Background(), req); err == nil {
			t.Errorf("req %+v: expected error for missing label", req)
		}
	}
}

func TestCreateServiceKeyHandlerSuccess(t *testing.T) {
	stub := newServiceKeyStub()
	h := NewKeysHandler(NewKeysService(stub), serviceTestIssuer(t))

	req := httptest.NewRequest(http.MethodPost, "/api/auth/keys/service",
		strings.NewReader(`{"label":"svc-handler","scopes":["finance:read"]}`))
	rec := httptest.NewRecorder()
	h.CreateServiceKey(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	var resp struct {
		ID        uuid.UUID `json:"id"`
		Key       string    `json:"key"`
		KeyPrefix string    `json:"key_prefix"`
		Label     string    `json:"label"`
		Scopes    []string  `json:"scopes"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.ID == uuid.Nil {
		t.Error("id missing")
	}
	if resp.Label != "svc-handler" {
		t.Errorf("label = %q", resp.Label)
	}
	if resp.KeyPrefix != ApiKeyPrefix {
		t.Errorf("key_prefix = %q, want %q", resp.KeyPrefix, ApiKeyPrefix)
	}
	if !strings.HasPrefix(resp.Key, ApiKeyPrefix) {
		t.Errorf("key %q missing prefix", resp.Key)
	}
	if len(resp.Scopes) != 1 || resp.Scopes[0] != "finance:read" {
		t.Errorf("scopes = %v", resp.Scopes)
	}
}

func TestCreateServiceKeyHandlerMissingLabel(t *testing.T) {
	stub := newServiceKeyStub()
	h := NewKeysHandler(NewKeysService(stub), serviceTestIssuer(t))

	for name, body := range map[string]string{
		"empty object":   `{}`,
		"empty label":    `{"label":""}`,
		"blank label":    `{"label":"   "}`,
		"malformed json": `not-json`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/keys/service", strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.CreateServiceKey(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", name, rec.Code)
		}
	}
	if n := len(stub.byHash); n != 0 {
		t.Errorf("rejected creates stored %d rows, want 0", n)
	}
}

func TestCreateServiceKeyHandlerGates(t *testing.T) {
	stub := newServiceKeyStub()
	h := NewKeysHandler(NewKeysService(stub), serviceTestIssuer(t))
	gated := RequireAuth()(RequireRole(RoleAdmin)(http.HandlerFunc(h.CreateServiceKey)))

	body := `{"label":"svc-gated"}`
	newReq := func() *http.Request {
		return httptest.NewRequest(http.MethodPost, "/api/auth/keys/service", strings.NewReader(body))
	}

	// Anonymous → 401.
	rec := httptest.NewRecorder()
	gated.ServeHTTP(rec, newReq())
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: status = %d, want 401", rec.Code)
	}

	// Non-admin → 403.
	rec = httptest.NewRecorder()
	gated.ServeHTTP(rec, requestWithRole(newReq(), RoleUser))
	if rec.Code != http.StatusForbidden {
		t.Errorf("non-admin: status = %d, want 403", rec.Code)
	}

	if n := len(stub.byHash); n != 0 {
		t.Fatalf("denied creates stored %d rows, want 0", n)
	}

	// Admin → 201.
	rec = httptest.NewRecorder()
	gated.ServeHTTP(rec, requestWithRole(newReq(), RoleAdmin))
	if rec.Code != http.StatusCreated {
		t.Fatalf("admin: status = %d, want 201", rec.Code)
	}
	if n := len(stub.byHash); n != 1 {
		t.Errorf("stored rows = %d, want 1", n)
	}
}

func TestServiceKeyPlaintextNeverReReadable(t *testing.T) {
	stub := newServiceKeyStub()
	svc := NewKeysService(stub)
	h := NewKeysHandler(svc, serviceTestIssuer(t))

	req := httptest.NewRequest(http.MethodPost, "/api/auth/keys/service",
		strings.NewReader(`{"label":"svc-once"}`))
	rec := httptest.NewRecorder()
	h.CreateServiceKey(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want 201", rec.Code)
	}
	var created struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if created.Key == "" {
		t.Fatal("create response missing plaintext")
	}

	listRec := httptest.NewRecorder()
	h.List(listRec, httptest.NewRequest(http.MethodGet, "/api/auth/keys", nil))
	if listRec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200", listRec.Code)
	}
	raw := listRec.Body.String()
	if strings.Contains(raw, created.Key) {
		t.Error("list response leaks plaintext service key")
	}
	if strings.Contains(raw, `"key":`) {
		t.Error(`list response must not contain a "key" field`)
	}
	var listed []keyHTTPResponse
	if err := json.Unmarshal([]byte(raw), &listed); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("listed rows = %d, want 1", len(listed))
	}
	if listed[0].Key != "" {
		t.Error("list row exposes plaintext key")
	}
}
