package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/token"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type stubKeys struct {
	userID uuid.UUID
	keyID  string
	scopes []string
	err    error
}

func (s stubKeys) ValidateKey(context.Context, string) (uuid.UUID, string, []string, error) {
	return s.userID, s.keyID, s.scopes, s.err
}

func stubExists(known ...uuid.UUID) UserExistsFunc {
	set := map[uuid.UUID]bool{}
	for _, id := range known {
		set[id] = true
	}
	return func(_ context.Context, id uuid.UUID) (bool, error) {
		return set[id], nil
	}
}

func requestAsAdmin(r *http.Request, id uuid.UUID) *http.Request {
	return r.WithContext(auth.ContextWithUser(r.Context(), &auth.UserContext{
		ID: id, Email: "admin@example.com", Role: auth.RoleAdmin,
	}))
}

func requestAsUser(r *http.Request, id uuid.UUID) *http.Request {
	return r.WithContext(auth.ContextWithUser(r.Context(), &auth.UserContext{
		ID: id, Email: "user@example.com", Role: auth.RoleUser,
	}))
}

func parseProxiedClaims(t *testing.T, iss *token.Issuer, edge func(http.Handler) http.Handler, req *http.Request) (token.Claims, string, int) {
	t.Helper()
	var gotAuth, gotQuery string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotQuery = r.URL.RawQuery
		w.WriteHeader(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	edge(next).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		return token.Claims{}, "", rec.Code
	}
	presented, ok := bearerToken(mustRequest(t, gotAuth))
	if !ok {
		t.Fatalf("proxied Authorization is not bearer: %q", gotAuth)
	}
	var claims token.Claims
	parsed, err := jwt.ParseWithClaims(presented, &claims, func(t *jwt.Token) (any, error) {
		return iss.Keys()[0].Public, nil
	})
	if err != nil || !parsed.Valid {
		t.Fatalf("minted token does not verify: %v", err)
	}
	return claims, gotQuery, rec.Code
}

func TestEdgeTargetingMatrix(t *testing.T) {
	adminID := uuid.New()
	userID := uuid.New()
	otherID := uuid.New()
	edge := func(iss *token.Issuer) func(http.Handler) http.Handler {
		return EdgeIdentity(iss, nil, stubExists(otherID))
	}

	t.Run("admin targeting other mints act_as and strips param", func(t *testing.T) {
		iss := testIssuer(t)
		req := requestAsAdmin(httptest.NewRequest(http.MethodGet, "/api/budget/remaining?user_id="+otherID.String(), nil), adminID)
		claims, query, code := parseProxiedClaims(t, iss, edge(iss), req)
		if code != http.StatusOK {
			t.Fatalf("status = %d, want 200", code)
		}
		if claims.Subject != adminID.String() {
			t.Errorf("sub = %q, want caller %q", claims.Subject, adminID)
		}
		if claims.ActAs != otherID.String() {
			t.Errorf("act_as = %q, want %q", claims.ActAs, otherID)
		}
		if query != "" {
			t.Errorf("proxied query = %q, want stripped", query)
		}
	})

	t.Run("non-admin targeting other is 403", func(t *testing.T) {
		iss := testIssuer(t)
		req := requestAsUser(httptest.NewRequest(http.MethodGet, "/api/budget/remaining?user_id="+otherID.String(), nil), userID)
		rec := httptest.NewRecorder()
		called := false
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })
		edge(iss)(next).ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
		if called {
			t.Error("next called on 403")
		}
	})

	t.Run("malformed target is 400", func(t *testing.T) {
		iss := testIssuer(t)
		req := requestAsAdmin(httptest.NewRequest(http.MethodGet, "/api/budget/remaining?user_id=zzz", nil), adminID)
		rec := httptest.NewRecorder()
		edge(iss)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})).ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
	})

	t.Run("unknown target is 404", func(t *testing.T) {
		iss := testIssuer(t)
		req := requestAsAdmin(httptest.NewRequest(http.MethodGet, "/api/budget/remaining?user_id="+uuid.New().String(), nil), adminID)
		rec := httptest.NewRecorder()
		edge(iss)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})).ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("own ID needs no lookup and sets no claim", func(t *testing.T) {
		iss := testIssuer(t)
		// exists stub knows NOBODY here: own ID must pass regardless.
		h := EdgeIdentity(iss, nil, stubExists())
		req := requestAsUser(httptest.NewRequest(http.MethodGet, "/api/budget/remaining?user_id="+userID.String(), nil), userID)
		claims, _, code := parseProxiedClaims(t, iss, h, req)
		if code != http.StatusOK {
			t.Fatalf("status = %d, want 200", code)
		}
		if claims.ActAs != "" {
			t.Errorf("act_as = %q, want empty for self-target", claims.ActAs)
		}
	})

	t.Run("absent param unchanged", func(t *testing.T) {
		iss := testIssuer(t)
		req := requestAsUser(httptest.NewRequest(http.MethodGet, "/api/budget/remaining", nil), userID)
		claims, _, code := parseProxiedClaims(t, iss, edge(iss), req)
		if code != http.StatusOK {
			t.Fatalf("status = %d, want 200", code)
		}
		if claims.ActAs != "" {
			t.Errorf("act_as = %q, want empty", claims.ActAs)
		}
	})

	t.Run("write with param is unaffected", func(t *testing.T) {
		iss := testIssuer(t)
		// Unknown target on a POST must NOT 404: writes ignore the param.
		req := requestAsAdmin(httptest.NewRequest(http.MethodPost, "/api/budget/expenses?user_id="+uuid.New().String(), nil), adminID)
		claims, _, code := parseProxiedClaims(t, iss, edge(iss), req)
		if code != http.StatusOK {
			t.Fatalf("status = %d, want 200", code)
		}
		if claims.ActAs != "" {
			t.Errorf("act_as = %q, want empty on writes", claims.ActAs)
		}
	})

	t.Run("lookup failure is 500", func(t *testing.T) {
		iss := testIssuer(t)
		fail := UserExistsFunc(func(context.Context, uuid.UUID) (bool, error) {
			return false, errors.New("db down")
		})
		h := EdgeIdentity(iss, nil, fail)
		req := requestAsAdmin(httptest.NewRequest(http.MethodGet, "/api/budget/remaining?user_id="+otherID.String(), nil), adminID)
		rec := httptest.NewRecorder()
		h(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})).ServeHTTP(rec, req)
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want 500", rec.Code)
		}
	})
}
