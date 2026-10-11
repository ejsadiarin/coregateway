package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// identityStubQuerier implements sqlc.Querier via embedding; only the
// methods this test exercises are overridden.
type identityStubQuerier struct {
	db.Querier
	keyByHash map[string]db.CoregatewayApiKey
	users     map[uuid.UUID]db.CoregatewayUser
}

func (q *identityStubQuerier) GetApiKeyByHash(_ context.Context, h string) (db.CoregatewayApiKey, error) {
	if row, ok := q.keyByHash[h]; ok {
		return row, nil
	}
	return db.CoregatewayApiKey{}, pgx.ErrNoRows
}

func (q *identityStubQuerier) GetUser(_ context.Context, id uuid.UUID) (db.CoregatewayUser, error) {
	if u, ok := q.users[id]; ok {
		return u, nil
	}
	return db.CoregatewayUser{}, pgx.ErrNoRows
}

func (q *identityStubQuerier) TouchApiKeyLastUsed(context.Context, uuid.UUID) error { return nil }

func identityTestSetup() (*Service, *KeysService, uuid.UUID, string) {
	adminID := uuid.New()
	plaintext := "test-identity-key"
	q := &identityStubQuerier{
		keyByHash: map[string]db.CoregatewayApiKey{
			HashAPIKey(plaintext): {
				ID:          uuid.New(),
				OwnerUserID: adminID,
				Scopes:      []string{"admin"},
			},
		},
		users: map[uuid.UUID]db.CoregatewayUser{
			adminID: {ID: adminID, Email: "admin@example.com", Role: RoleAdmin},
		},
	}
	return NewService(q), NewKeysService(q), adminID, plaintext
}

func TestRequireIdentitySessionHitPassesThrough(t *testing.T) {
	svc, keys, adminID, _ := identityTestSetup()
	var seen *UserContext
	var seenScopes []string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = GetUserFromContext(r)
		seenScopes, _ = KeyScopesFromContext(r)
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(ContextWithUser(req.Context(), &UserContext{
		ID: adminID, Email: "admin@example.com", Role: RoleAdmin,
	}))
	rec := httptest.NewRecorder()
	RequireIdentity(svc, keys)(next).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if seen == nil || seen.ID != adminID {
		t.Errorf("identity = %+v, want session admin", seen)
	}
	if seenScopes != nil {
		t.Errorf("key scopes = %v, want nil for session caller", seenScopes)
	}
}

func TestRequireIdentityKeyHitInjectsOwner(t *testing.T) {
	svc, keys, adminID, plaintext := identityTestSetup()
	var seen *UserContext
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = GetUserFromContext(r)
		if !KeyHasScope(r, "admin") {
			t.Error("KeyHasScope(admin) = false, want true")
		}
		if KeyHasScope(r, "corefinance:read") {
			t.Error("KeyHasScope(corefinance:read) = true, want false")
		}
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+plaintext)
	rec := httptest.NewRecorder()
	RequireIdentity(svc, keys)(next).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if seen == nil || seen.ID != adminID || seen.Role != RoleAdmin {
		t.Errorf("identity = %+v, want key owner admin", seen)
	}
}

func TestRequireIdentityBadKeyRejected(t *testing.T) {
	svc, keys, _, _ := identityTestSetup()
	reached := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer garbage")
	rec := httptest.NewRecorder()
	RequireIdentity(svc, keys)(next).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
	if reached {
		t.Error("next handler reached with bad key")
	}
}

func TestRequireIdentityNoCredentialsPassthrough(t *testing.T) {
	svc, keys, _, _ := identityTestSetup()
	reached := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		if GetUserFromContext(r) != nil {
			t.Error("unexpected identity injected")
		}
		w.WriteHeader(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	RequireIdentity(svc, keys)(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK || !reached {
		t.Errorf("status = %d reached = %v, want passthrough", rec.Code, reached)
	}
}

func TestRequireIdentitySessionWinsOverKey(t *testing.T) {
	svc, keys, _, plaintext := identityTestSetup()
	otherID := uuid.New()
	var seen *UserContext
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = GetUserFromContext(r)
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+plaintext)
	req = req.WithContext(ContextWithUser(req.Context(), &UserContext{
		ID: otherID, Email: "session@example.com", Role: RoleUser,
	}))
	rec := httptest.NewRecorder()
	RequireIdentity(svc, keys)(next).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if seen == nil || seen.ID != otherID {
		t.Errorf("identity = %+v, want session user (key ignored)", seen)
	}
}

func TestRequireKeyScope(t *testing.T) {
	svc, keys, _, plaintext := identityTestSetup()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := RequireIdentity(svc, keys)(RequireKeyScope("admin")(next))

	t.Run("key with scope passes", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.Header.Set("Authorization", "Bearer "+plaintext)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})

	t.Run("session caller passes (role path)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req = req.WithContext(ContextWithUser(req.Context(), &UserContext{
			ID: uuid.New(), Email: "a@example.com", Role: RoleAdmin,
		}))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", rec.Code)
		}
	})
}

func TestKeyCoversScope(t *testing.T) {
	cases := []struct {
		name string
		held []string
		need string
		want bool
	}{
		{"admin covers admin", []string{"admin"}, "admin", true},
		{"admin covers service read", []string{"admin"}, "corefinance:read", true},
		{"admin covers service admin", []string{"admin"}, "corefinance:admin", true},
		{"admin covers other service", []string{"admin"}, "othersvc:write", true},
		{"service admin covers read", []string{"corefinance:admin"}, "corefinance:read", true},
		{"service admin covers write", []string{"corefinance:admin"}, "corefinance:write", true},
		{"service admin covers self", []string{"corefinance:admin"}, "corefinance:admin", true},
		{"service admin not other service", []string{"corefinance:admin"}, "othersvc:read", false},
		{"service admin not master", []string{"corefinance:admin"}, "admin", false},
		{"exact read match", []string{"corefinance:read"}, "corefinance:read", true},
		{"read not write", []string{"corefinance:read"}, "corefinance:write", false},
		{"write not read", []string{"corefinance:write"}, "corefinance:read", false},
		{"empty held covers nothing", nil, "corefinance:read", false},
		{"empty held not admin", []string{}, "admin", false},
		{"second held entry matches", []string{"corefinance:write", "othersvc:read"}, "othersvc:read", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := KeyCoversScope(tc.held, tc.need); got != tc.want {
				t.Errorf("KeyCoversScope(%v, %q) = %v, want %v", tc.held, tc.need, got, tc.want)
			}
		})
	}
}

func TestRequireKeyScopeFor(t *testing.T) {
	owner := uuid.New()
	q := &identityStubQuerier{
		keyByHash: map[string]db.CoregatewayApiKey{},
		users: map[uuid.UUID]db.CoregatewayUser{
			owner: {ID: owner, Email: "owner@example.com", Role: RoleUser},
		},
	}
	keyFor := func(scopes ...string) string {
		plaintext := "key-" + strings.Join(scopes, ",")
		q.keyByHash[HashAPIKey(plaintext)] = db.CoregatewayApiKey{
			ID:          uuid.New(),
			OwnerUserID: owner,
			Scopes:      scopes,
		}
		return plaintext
	}
	svc, keys := NewService(q), NewKeysService(q)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	serve := func(t *testing.T, write bool, req *http.Request) int {
		t.Helper()
		h := RequireIdentity(svc, keys)(RequireKeyScopeFor("corefinance", write)(next))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	withKey := func(scopes ...string) *http.Request {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer "+keyFor(scopes...))
		return req
	}

	t.Run("read key passes read gate", func(t *testing.T) {
		if code := serve(t, false, withKey("corefinance:read")); code != http.StatusOK {
			t.Errorf("status = %d, want 200", code)
		}
	})
	t.Run("write key fails read gate", func(t *testing.T) {
		if code := serve(t, false, withKey("corefinance:write")); code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", code)
		}
	})
	t.Run("read key fails write gate", func(t *testing.T) {
		if code := serve(t, true, withKey("corefinance:read")); code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", code)
		}
	})
	t.Run("service-admin passes both gates", func(t *testing.T) {
		if code := serve(t, false, withKey("corefinance:admin")); code != http.StatusOK {
			t.Errorf("read: status = %d, want 200", code)
		}
		if code := serve(t, true, withKey("corefinance:admin")); code != http.StatusOK {
			t.Errorf("write: status = %d, want 200", code)
		}
	})
	t.Run("wrong-service key fails", func(t *testing.T) {
		if code := serve(t, false, withKey("othersvc:read")); code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", code)
		}
	})
	t.Run("session caller passes both gates (role path)", func(t *testing.T) {
		for _, write := range []bool{false, true} {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req = req.WithContext(ContextWithUser(req.Context(), &UserContext{
				ID: uuid.New(), Email: "u@example.com", Role: RoleUser,
			}))
			if code := serve(t, write, req); code != http.StatusOK {
				t.Errorf("write=%v: status = %d, want 200", write, code)
			}
		}
	})
	t.Run("anonymous passes through to downstream gates", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		if code := serve(t, false, req); code != http.StatusOK {
			t.Errorf("status = %d, want 200 (passthrough)", code)
		}
	})
}

func TestRequireServiceKeyScope(t *testing.T) {
	owner := uuid.New()
	q := &identityStubQuerier{
		keyByHash: map[string]db.CoregatewayApiKey{},
		users: map[uuid.UUID]db.CoregatewayUser{
			owner: {ID: owner, Email: "owner@example.com", Role: RoleUser},
		},
	}
	keyFor := func(scopes ...string) string {
		plaintext := "svc-key-" + strings.Join(scopes, ",")
		q.keyByHash[HashAPIKey(plaintext)] = db.CoregatewayApiKey{
			ID:          uuid.New(),
			OwnerUserID: owner,
			Scopes:      scopes,
		}
		return plaintext
	}
	svc, keys := NewService(q), NewKeysService(q)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	serve := func(t *testing.T, method string, req *http.Request) int {
		t.Helper()
		h := RequireIdentity(svc, keys)(RequireServiceKeyScope("corefinance")(next))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	withKey := func(method string, scopes ...string) *http.Request {
		req := httptest.NewRequest(method, "/", nil)
		req.Header.Set("Authorization", "Bearer "+keyFor(scopes...))
		return req
	}

	t.Run("GET needs read cover", func(t *testing.T) {
		if code := serve(t, http.MethodGet, withKey(http.MethodGet, "corefinance:read")); code != http.StatusOK {
			t.Errorf("read key GET: status = %d, want 200", code)
		}
		if code := serve(t, http.MethodGet, withKey(http.MethodGet, "corefinance:write")); code != http.StatusForbidden {
			t.Errorf("write key GET: status = %d, want 403", code)
		}
	})
	t.Run("POST needs write cover", func(t *testing.T) {
		if code := serve(t, http.MethodPost, withKey(http.MethodPost, "corefinance:write")); code != http.StatusOK {
			t.Errorf("write key POST: status = %d, want 200", code)
		}
		if code := serve(t, http.MethodPost, withKey(http.MethodPost, "corefinance:read")); code != http.StatusForbidden {
			t.Errorf("read key POST: status = %d, want 403", code)
		}
	})
	t.Run("service-admin passes both", func(t *testing.T) {
		if code := serve(t, http.MethodGet, withKey(http.MethodGet, "corefinance:admin")); code != http.StatusOK {
			t.Errorf("GET: status = %d, want 200", code)
		}
		if code := serve(t, http.MethodPost, withKey(http.MethodPost, "corefinance:admin")); code != http.StatusOK {
			t.Errorf("POST: status = %d, want 200", code)
		}
	})
	t.Run("session passes both methods", func(t *testing.T) {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			req := httptest.NewRequest(method, "/", nil)
			req = req.WithContext(ContextWithUser(req.Context(), &UserContext{
				ID: uuid.New(), Email: "u@example.com", Role: RoleUser,
			}))
			if code := serve(t, method, req); code != http.StatusOK {
				t.Errorf("%s: status = %d, want 200", method, code)
			}
		}
	})
}
