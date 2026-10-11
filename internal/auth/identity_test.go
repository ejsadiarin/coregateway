package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
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
