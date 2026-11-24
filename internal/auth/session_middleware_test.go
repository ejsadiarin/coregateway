package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/ejsadiarin/coregateway/internal/session"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// sessionStub answers the session lookup with a fixed result.
type sessionStub struct {
	db.Querier
	sessionErr error
	userID     uuid.UUID
	expiresAt  time.Time // wall clock, as the sessions table stores it
	extendErr  error
	extended   *db.ExtendSessionParams
}

func (s *sessionStub) GetSessionByTokenHash(_ context.Context, _ string) (db.GetSessionByTokenHashRow, error) {
	if s.sessionErr != nil {
		return db.GetSessionByTokenHashRow{}, s.sessionErr
	}
	return db.GetSessionByTokenHashRow{
		UserID:    s.userID,
		ExpiresAt: pgtype.Timestamp{Time: s.expiresAt, Valid: true},
	}, nil
}

func (s *sessionStub) ExtendSession(_ context.Context, arg db.ExtendSessionParams) error {
	s.extended = &arg
	return s.extendErr
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

// sessionCookie returns the session cookie the response set, if any.
func sessionCookie(rec *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == session.CookieName {
			return c
		}
	}
	return nil
}

// expiresIn is a session expiry d from now, on the stored wall clock.
func expiresIn(d time.Duration) time.Time { return wallClock(time.Now()).Add(d) }

func TestAuthMiddlewareValidSession(t *testing.T) {
	rec, _ := runSessionMiddleware(t, &sessionStub{userID: uuid.New(), expiresAt: expiresIn(23*time.Hour + 30*time.Minute)})
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

// A session in use lasts its window from now: the row and the cookie move.
func TestAuthMiddlewareExtendsSessionInUse(t *testing.T) {
	cases := []struct {
		name   string
		left   time.Duration
		window time.Duration
	}{
		{"normal session", 3 * time.Hour, session.SessionExpiry},
		{"remember me", 10 * 24 * time.Hour, session.RememberMeExpiry},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &sessionStub{userID: uuid.New(), expiresAt: expiresIn(tc.left)}
			rec, _ := runSessionMiddleware(t, stub)
			if rec.Code != http.StatusOK {
				t.Fatalf("code = %d, want 200", rec.Code)
			}
			if stub.extended == nil {
				t.Fatal("session not extended")
			}
			if got := stub.extended.ExpiresAt.Time.Sub(wallClock(time.Now())); got < tc.window-time.Minute || got > tc.window {
				t.Fatalf("extended to %v from now, want %v", got, tc.window)
			}
			c := sessionCookie(rec)
			if c == nil || c.Value != "tok" || c.MaxAge != int(tc.window.Seconds()) {
				t.Fatalf("cookie = %+v, want tok with MaxAge %d", c, int(tc.window.Seconds()))
			}
		})
	}
}

// Extended within the last hour: no write, no cookie.
func TestAuthMiddlewareThrottlesExtension(t *testing.T) {
	for _, left := range []time.Duration{session.SessionExpiry - 10*time.Minute, session.RememberMeExpiry - 10*time.Minute} {
		stub := &sessionStub{userID: uuid.New(), expiresAt: expiresIn(left)}
		rec, _ := runSessionMiddleware(t, stub)
		if rec.Code != http.StatusOK || stub.extended != nil || sessionCookie(rec) != nil {
			t.Fatalf("left %v: code = %d, extended = %v, cookie = %v; want 200 with no write and no cookie",
				left, rec.Code, stub.extended != nil, sessionCookie(rec))
		}
	}
}

// Failing to extend is not a sign-out: the request goes through as before.
func TestAuthMiddlewareExtendFailureKeepsUserSignedIn(t *testing.T) {
	stub := &sessionStub{userID: uuid.New(), expiresAt: expiresIn(time.Hour), extendErr: errors.New("conn reset")}
	rec, _ := runSessionMiddleware(t, stub)
	if rec.Code != http.StatusOK || sessionCookie(rec) != nil {
		t.Fatalf("code = %d, cookie = %v; want 200 and the cookie left alone", rec.Code, sessionCookie(rec))
	}
}
