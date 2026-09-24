package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func requestWithRole(r *http.Request, role string) *http.Request {
	return r.WithContext(ContextWithUser(r.Context(), &UserContext{
		ID:    uuid.New(),
		Email: role + "@example.com",
		Role:  role,
	}))
}

func TestRequireRole(t *testing.T) {
	pass := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	handler := RequireRole(RoleAdmin)(pass)

	// Anonymous (no user in ctx) → 401.
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/auth/sessions/x", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: status = %d, want 401", rec.Code)
	}

	// Authenticated non-admin → 403.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, requestWithRole(httptest.NewRequest(http.MethodDelete, "/api/auth/sessions/x", nil), RoleUser))
	if rec.Code != http.StatusForbidden {
		t.Errorf("non-admin: status = %d, want 403", rec.Code)
	}

	// Admin → passes through.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, requestWithRole(httptest.NewRequest(http.MethodDelete, "/api/auth/sessions/x", nil), RoleAdmin))
	if rec.Code != http.StatusNoContent {
		t.Errorf("admin: status = %d, want 204", rec.Code)
	}
}
