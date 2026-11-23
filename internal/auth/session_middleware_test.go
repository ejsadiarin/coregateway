package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/ejsadiarin/coregateway/internal/session"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// sessionStub answers the session lookup with a fixed result.
type sessionStub struct {
	db.Querier
	sessionErr error
	userID     uuid.UUID
}

func (s *sessionStub) GetSessionByTokenHash(_ context.Context, _ string) (db.GetSessionByTokenHashRow, error) {
	if s.sessionErr != nil {
		return db.GetSessionByTokenHashRow{}, s.sessionErr
	}
	return db.GetSessionByTokenHashRow{UserID: s.userID}, nil
}

func (s *sessionStub) GetUser(_ context.Context, id uuid.UUID) (db.CoregatewayUser, error) {
	return db.CoregatewayUser{ID: id, Email: "owner@example.com", Role: "admin"}, nil
}

func runSessionMiddleware(t *testing.T, q db.Querier) (*httptest.ResponseRecorder, bool) {
	t.Helper()
	reached := false
	h := AuthMiddleware(NewService(q))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		if GetUserFromContext(r) == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: session.CookieName, Value: "tok"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec, reached
}

func clearsCookie(rec *httptest.ResponseRecorder) bool {
	for _, c := range rec.Result().Cookies() {
		if c.Name == session.CookieName && c.MaxAge < 0 {
			return true
		}
	}
	return false
}

func TestAuthMiddlewareValidSession(t *testing.T) {
	rec, _ := runSessionMiddleware(t, &sessionStub{userID: uuid.New()})
	if rec.Code != http.StatusOK || clearsCookie(rec) {
		t.Fatalf("code = %d, cleared = %v; want 200 and cookie kept", rec.Code, clearsCookie(rec))
	}
}

func TestAuthMiddlewareUnknownSessionClearsCookie(t *testing.T) {
	rec, reached := runSessionMiddleware(t, &sessionStub{sessionErr: pgx.ErrNoRows})
	if !reached || rec.Code != http.StatusUnauthorized || !clearsCookie(rec) {
		t.Fatalf("reached = %v, code = %d, cleared = %v; want anonymous 401 with cookie cleared", reached, rec.Code, clearsCookie(rec))
	}
}

// A database that is waking up or unreachable is not a logout: the cookie
// stays and the client is told to retry.
func TestAuthMiddlewareLookupFailureKeepsCookie(t *testing.T) {
	rec, reached := runSessionMiddleware(t, &sessionStub{sessionErr: errors.New("dial tcp: i/o timeout")})
	if reached {
		t.Fatal("handler ran without a confirmed session")
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d, want 503", rec.Code)
	}
	if clearsCookie(rec) {
		t.Fatal("cookie cleared on a lookup failure")
	}
}
