package server

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/config"
	"github.com/ejsadiarin/coregateway/internal/crypto"
	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	monitor "github.com/ejsadiarin/coregateway/internal/monitor"
	"github.com/ejsadiarin/coregateway/internal/services/corefinance"
	"github.com/ejsadiarin/coregateway/internal/token"
	"github.com/ejsadiarin/coregateway/internal/user"
)

// keyAuthStubQuerier backs the session-or-key matrix: users, keys, and a
// password login. Unknown keys/hashes report pgx.ErrNoRows like postgres.
type keyAuthStubQuerier struct {
	db.Querier
	users       map[uuid.UUID]db.CoregatewayUser
	keyByHash   map[string]db.CoregatewayApiKey
	keysCreated []db.CreateApiKeyParams
	usersCreated int
}

func (q *keyAuthStubQuerier) ListUsers(context.Context) ([]db.CoregatewayUser, error) {
	out := make([]db.CoregatewayUser, 0, len(q.users))
	for _, u := range q.users {
		out = append(out, u)
	}
	return out, nil
}

func (q *keyAuthStubQuerier) GetUser(_ context.Context, id uuid.UUID) (db.CoregatewayUser, error) {
	if u, ok := q.users[id]; ok {
		return u, nil
	}
	return db.CoregatewayUser{}, pgx.ErrNoRows
}

func (q *keyAuthStubQuerier) GetUserByEmail(_ context.Context, email string) (db.CoregatewayUser, error) {
	for _, u := range q.users {
		if u.Email == email {
			return u, nil
		}
	}
	return db.CoregatewayUser{}, pgx.ErrNoRows
}

func (q *keyAuthStubQuerier) CreateUser(_ context.Context, arg db.CreateUserParams) (db.CoregatewayUser, error) {
	q.usersCreated++
	u := db.CoregatewayUser{ID: uuid.New(), Email: arg.Email, Role: arg.Role}
	q.users[u.ID] = u
	return u, nil
}

func (q *keyAuthStubQuerier) UpdateUser(_ context.Context, arg db.UpdateUserParams) (db.CoregatewayUser, error) {
	u := q.users[arg.ID]
	if arg.Email.Valid {
		u.Email = arg.Email.String
	}
	if arg.Role.Valid {
		u.Role = arg.Role.String
	}
	q.users[arg.ID] = u
	return u, nil
}

func (q *keyAuthStubQuerier) DeleteUserSessions(context.Context, uuid.UUID) error { return nil }

func (q *keyAuthStubQuerier) DeleteUser(_ context.Context, id uuid.UUID) error {
	delete(q.users, id)
	return nil
}

func (q *keyAuthStubQuerier) CreateSession(context.Context, db.CreateSessionParams) (db.CoregatewaySession, error) {
	return db.CoregatewaySession{ID: uuid.New()}, nil
}

func (q *keyAuthStubQuerier) GetApiKeyByHash(_ context.Context, h string) (db.CoregatewayApiKey, error) {
	if row, ok := q.keyByHash[h]; ok {
		return row, nil
	}
	return db.CoregatewayApiKey{}, pgx.ErrNoRows
}

func (q *keyAuthStubQuerier) CreateApiKey(_ context.Context, arg db.CreateApiKeyParams) (db.CoregatewayApiKey, error) {
	q.keysCreated = append(q.keysCreated, arg)
	return db.CoregatewayApiKey{
		ID: uuid.New(), KeyPrefix: arg.KeyPrefix, Label: arg.Label,
		OwnerUserID: arg.OwnerUserID, Scopes: arg.Scopes,
	}, nil
}

func (q *keyAuthStubQuerier) ListApiKeys(context.Context) ([]db.ListApiKeysRow, error) {
	return []db.ListApiKeysRow{}, nil
}

func (q *keyAuthStubQuerier) RevokeApiKey(context.Context, uuid.UUID) (int64, error) {
	return 1, nil
}

func (q *keyAuthStubQuerier) TouchApiKeyLastUsed(context.Context, uuid.UUID) error { return nil }

func (q *keyAuthStubQuerier) ListServices(context.Context) ([]db.ListServicesRow, error) {
	return []db.ListServicesRow{}, nil
}

const (
	testAdminKeyPlaintext = "test-admin-key"
	testReadKeyPlaintext  = "test-read-key"
	testWriteKeyPlaintext = "test-write-key"
	testAdminReadKeyPlaintext = "test-admin-read-key"
)

func keyAuthTestSetup(t *testing.T) (http.Handler, *keyAuthStubQuerier, uuid.UUID, uuid.UUID) {
	t.Helper()
	adminID := uuid.New()
	userID := uuid.New()
	pwHash, err := crypto.HashPassword("password123")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	q := &keyAuthStubQuerier{
		users: map[uuid.UUID]db.CoregatewayUser{
			adminID: {ID: adminID, Email: "admin@example.com", Role: auth.RoleAdmin, PasswordHash: pgtype.Text{String: pwHash, Valid: true}},
			userID:  {ID: userID, Email: "user@example.com", Role: auth.RoleUser},
		},
		keyByHash: map[string]db.CoregatewayApiKey{
			auth.HashAPIKey(testAdminKeyPlaintext): {ID: uuid.New(), OwnerUserID: adminID, Scopes: []string{"admin"}},
			auth.HashAPIKey(testReadKeyPlaintext):  {ID: uuid.New(), OwnerUserID: userID, Scopes: []string{"corefinance:read"}},
			auth.HashAPIKey(testWriteKeyPlaintext): {ID: uuid.New(), OwnerUserID: adminID, Scopes: []string{"corefinance:write"}},
			auth.HashAPIKey(testAdminReadKeyPlaintext): {ID: uuid.New(), OwnerUserID: adminID, Scopes: []string{"corefinance:read"}},
		},
	}
	authSvc := auth.NewService(q)
	keysSvc := auth.NewKeysService(q)
	fake := &fakeDownstream{}
	downstream := httptest.NewServer(fake)
	t.Cleanup(downstream.Close)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	iss, err := token.NewIssuer(
		token.Key{KID: "2026-09-a", Private: priv, Public: pub},
		nil, "https://gateway.internal", []string{"corefinance"}, 300*time.Second,
	)
	if err != nil {
		t.Fatalf("new issuer: %v", err)
	}
	s := &Server{
		AuthService:       authSvc,
		AuthHandler:       auth.NewHandler(authSvc),
		KeysService:       keysSvc,
		KeysHandler:       auth.NewKeysHandler(keysSvc),
		UserHandler:       user.NewHandler(user.NewService(q)),
		ServiceHandler:    monitor.NewHandler(monitor.NewService(q)),
		CorefinanceClient: corefinance.New(downstream.URL),
		TokenIssuer:       iss,
	}
	return s.RegisterRoutes(&config.Config{}), q, adminID, userID
}

func doKeyRequest(t *testing.T, h http.Handler, key, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, target, nil)
	} else {
		req = httptest.NewRequest(method, target, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// doSessionRequest injects a session identity (no Bearer key).
func doSessionRequest(t *testing.T, h http.Handler, id uuid.UUID, role, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, target, nil)
	} else {
		req = httptest.NewRequest(method, target, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
	}
	req = req.WithContext(auth.ContextWithUser(req.Context(), &auth.UserContext{
		ID: id, Email: role + "@example.com", Role: role,
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// mintPlaintext POSTs a key and returns the one-time plaintext.
func mintPlaintext(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode mint response: %v", err)
	}
	key, _ := resp["key"].(string)
	if key == "" {
		t.Fatal("mint response has no one-time plaintext key")
	}
	return key
}

func TestSelfServiceMintMatrix(t *testing.T) {
	t.Run("non-admin session mints read key, key reads own budget", func(t *testing.T) {
		h, q, _, userID := keyAuthTestSetup(t)
		rec := doSessionRequest(t, h, userID, auth.RoleUser, http.MethodPost, "/api/auth/keys", `{"label":"mine","scopes":["corefinance:read"]}`)
		if rec.Code != http.StatusCreated {
			t.Fatalf("mint status = %d, want 201", rec.Code)
		}
		if len(q.keysCreated) != 1 {
			t.Fatalf("keysCreated = %d, want 1", len(q.keysCreated))
		}
		created := q.keysCreated[0]
		if created.OwnerUserID != userID {
			t.Errorf("owner = %s, want caller %s", created.OwnerUserID, userID)
		}
		// Register the minted key as known, then prove it works.
		key := mintPlaintext(t, rec)
		q.keyByHash[auth.HashAPIKey(key)] = db.CoregatewayApiKey{
			ID: uuid.New(), OwnerUserID: userID, Scopes: []string{"corefinance:read"},
		}
		if rec := doKeyRequest(t, h, key, http.MethodGet, "/api/budget/remaining", ""); rec.Code != http.StatusOK {
			t.Errorf("budget status = %d, want 200", rec.Code)
		}
	})

	t.Run("non-admin session cannot mint admin scope", func(t *testing.T) {
		h, q, _, userID := keyAuthTestSetup(t)
		rec := doSessionRequest(t, h, userID, auth.RoleUser, http.MethodPost, "/api/auth/keys", `{"label":"evil","scopes":["admin"]}`)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if len(q.keysCreated) != 0 {
			t.Errorf("keysCreated = %d, want 0", len(q.keysCreated))
		}
	})

	t.Run("non-admin key cannot mint admin scope", func(t *testing.T) {
		h, q, _, _ := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodPost, "/api/auth/keys", `{"label":"evil","scopes":["admin"]}`)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if len(q.keysCreated) != 0 {
			t.Errorf("keysCreated = %d, want 0", len(q.keysCreated))
		}
	})

	t.Run("non-admin read key mints read key (scope-down)", func(t *testing.T) {
		h, q, _, userID := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodPost, "/api/auth/keys", `{"label":"sub","scopes":["corefinance:read"]}`)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201", rec.Code)
		}
		if len(q.keysCreated) != 1 || q.keysCreated[0].OwnerUserID != userID {
			t.Errorf("keysCreated = %+v, want one key owned by %s", q.keysCreated, userID)
		}
	})

	t.Run("admin session mint unchanged", func(t *testing.T) {
		h, q, adminID, _ := keyAuthTestSetup(t)
		rec := doSessionRequest(t, h, adminID, auth.RoleAdmin, http.MethodPost, "/api/auth/keys", `{"label":"ops","scopes":["admin"]}`)
		if rec.Code != http.StatusCreated {
			t.Errorf("status = %d, want 201", rec.Code)
		}
		if len(q.keysCreated) != 1 {
			t.Errorf("keysCreated = %d, want 1", len(q.keysCreated))
		}
	})
}

func TestSessionOrKeyIdentityMatrix(t *testing.T) {
	t.Run("self-read with owned key", func(t *testing.T) {
		h, _, _, userID := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodGet, "/api/users/"+userID.String(), "")
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})

	t.Run("other-user read with non-admin key", func(t *testing.T) {
		h, _, adminID, _ := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodGet, "/api/users/"+adminID.String(), "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("low-scope key cannot create users", func(t *testing.T) {
		h, q, _, _ := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodPost, "/api/users", `{"email":"n@example.com","password":"password123","role":"user"}`)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if q.usersCreated != 0 {
			t.Errorf("usersCreated = %d, want 0", q.usersCreated)
		}
	})

	t.Run("admin key creates user", func(t *testing.T) {
		h, q, _, _ := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/users", `{"email":"n@example.com","password":"password123","role":"user"}`)
		if rec.Code != http.StatusCreated {
			t.Errorf("status = %d, want 201", rec.Code)
		}
		if q.usersCreated != 1 {
			t.Errorf("usersCreated = %d, want 1", q.usersCreated)
		}
	})

	t.Run("low-scope key cannot mint admin key", func(t *testing.T) {
		h, q, _, _ := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodPost, "/api/auth/keys", `{"label":"evil","scopes":["admin"]}`)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if len(q.keysCreated) != 0 {
			t.Errorf("keysCreated = %d, want 0", len(q.keysCreated))
		}
	})

	t.Run("admin key mints key", func(t *testing.T) {
		h, q, _, _ := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/auth/keys", `{"label":"ops","scopes":["corefinance:read"]}`)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201", rec.Code)
		}
		var resp map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if resp["key"] == "" {
			t.Error("response has no one-time plaintext key")
		}
		if len(q.keysCreated) != 1 {
			t.Errorf("keysCreated = %d, want 1", len(q.keysCreated))
		}
	})

	t.Run("invalid key rejected", func(t *testing.T) {
		h, _, _, userID := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, "garbage", http.MethodGet, "/api/users/"+userID.String(), "")
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401", rec.Code)
		}
	})

	t.Run("key-authed key list and me", func(t *testing.T) {
		h, _, _, _ := keyAuthTestSetup(t)
		if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/auth/keys", ""); rec.Code != http.StatusOK {
			t.Errorf("list status = %d, want 200", rec.Code)
		}
		if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/auth/me", ""); rec.Code != http.StatusOK {
			t.Errorf("me status = %d, want 200", rec.Code)
		}
	})

	t.Run("low-scope key on services rejected", func(t *testing.T) {
		h, _, _, _ := keyAuthTestSetup(t)
		if rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodGet, "/api/services/list", ""); rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("admin key on services passes", func(t *testing.T) {
		h, _, _, _ := keyAuthTestSetup(t)
		if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/services/list", ""); rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})

	t.Run("key-authed delete with low-scope key rejected", func(t *testing.T) {
		h, _, _, _ := keyAuthTestSetup(t)
		victim := uuid.New()
		rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodDelete, "/api/users/"+victim.String(), "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("key on login ignored", func(t *testing.T) {
		h, _, _, _ := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/auth/login", `{"email":"admin@example.com","password":"password123"}`)
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
		if strings.Contains(rec.Header().Get("Set-Cookie"), "session_token") == false {
			t.Error("login did not issue session cookie")
		}
	})
}

func TestKeyScopeListGates(t *testing.T) {
	t.Run("write-only key cannot list users, leaks nothing", func(t *testing.T) {
		h, _, _, _ := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testWriteKeyPlaintext, http.MethodGet, "/api/users", "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		for _, leak := range []string{"admin@example.com", "user@example.com"} {
			if strings.Contains(rec.Body.String(), leak) {
				t.Errorf("rejection body leaks %q", leak)
			}
		}
	})

	t.Run("write-only key cannot list key inventory, leaks nothing", func(t *testing.T) {
		h, _, _, _ := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testWriteKeyPlaintext, http.MethodGet, "/api/auth/keys", "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		for _, leak := range []string{"test-admin-key", "key_prefix"} {
			if strings.Contains(rec.Body.String(), leak) {
				t.Errorf("rejection body leaks %q", leak)
			}
		}
	})

	t.Run("admin key lists both", func(t *testing.T) {
		h, _, _, _ := keyAuthTestSetup(t)
		if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/users", ""); rec.Code != http.StatusOK {
			t.Errorf("users status = %d, want 200", rec.Code)
		}
		if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/auth/keys", ""); rec.Code != http.StatusOK {
			t.Errorf("keys status = %d, want 200", rec.Code)
		}
	})
}

func TestKeyScopeOtherReads(t *testing.T) {
	t.Run("admin-owned read key cannot read other profile", func(t *testing.T) {
		h, _, _, userID := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testAdminReadKeyPlaintext, http.MethodGet, "/api/users/"+userID.String(), "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("admin-owned read key reads self scope-free", func(t *testing.T) {
		h, _, adminID, _ := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testAdminReadKeyPlaintext, http.MethodGet, "/api/users/"+adminID.String(), "")
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})

	t.Run("write-only key reads self scope-free", func(t *testing.T) {
		h, _, adminID, _ := keyAuthTestSetup(t)
		rec := doKeyRequest(t, h, testWriteKeyPlaintext, http.MethodGet, "/api/users/"+adminID.String(), "")
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})
}
