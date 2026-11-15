package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/google/uuid"
)

// stubUsers is a lookup over a fixed set of users.
func stubUsers(users map[uuid.UUID]UserRecord) UserLookupFunc {
	return func(_ context.Context, id uuid.UUID) (UserRecord, bool, error) {
		u, ok := users[id]
		return u, ok, nil
	}
}

// stubAnyone knows every user, as a plain user in UTC.
func stubAnyone(context.Context, uuid.UUID) (UserRecord, bool, error) {
	return UserRecord{Role: auth.RoleUser, Timezone: "UTC"}, true, nil
}

// The internal token carries the timezone of the user the request is
// about (ADR-0005): the caller, or the target user in a targeted read.
func TestEdgeIdentityMintsTheTimezoneOfTheUserTheRequestIsAbout(t *testing.T) {
	adminID, userID, otherID := uuid.New(), uuid.New(), uuid.New()
	users := stubUsers(map[uuid.UUID]UserRecord{
		adminID: {Role: auth.RoleAdmin, Timezone: "Europe/Berlin"},
		userID:  {Role: auth.RoleUser, Timezone: "Asia/Manila"},
		otherID: {Role: auth.RoleUser, Timezone: "America/New_York"},
	})

	t.Run("session caller gets their own timezone", func(t *testing.T) {
		iss := testIssuer(t)
		req := requestAsUser(httptest.NewRequest(http.MethodGet, "/api/budget/remaining", nil), userID)
		claims, _, code := parseProxiedClaims(t, iss, EdgeIdentity("corefinance", iss, nil, users), req)
		if code != http.StatusOK {
			t.Fatalf("status = %d, want 200", code)
		}
		if claims.TZ != "Asia/Manila" {
			t.Errorf("tz = %q, want the caller's Asia/Manila", claims.TZ)
		}
	})

	t.Run("targeted read gets the target user's timezone", func(t *testing.T) {
		iss := testIssuer(t)
		req := requestAsAdmin(httptest.NewRequest(http.MethodGet, "/api/budget/remaining?user_id="+otherID.String(), nil), adminID)
		claims, _, code := parseProxiedClaims(t, iss, EdgeIdentity("corefinance", iss, nil, users), req)
		if code != http.StatusOK {
			t.Fatalf("status = %d, want 200", code)
		}
		if claims.TZ != "America/New_York" {
			t.Errorf("tz = %q, want the target's America/New_York", claims.TZ)
		}
	})

	t.Run("key caller gets the key owner's timezone", func(t *testing.T) {
		iss := testIssuer(t)
		keys := stubValidator{userID: userID, keyID: "key-1", scopes: []string{"corefinance:read"}}
		req := httptest.NewRequest(http.MethodGet, "/api/budget/remaining", nil)
		req.Header.Set("Authorization", "Bearer key-material")
		claims, _, code := parseProxiedClaims(t, iss, EdgeIdentity("corefinance", iss, keys, users), req)
		if code != http.StatusOK {
			t.Fatalf("status = %d, want 200", code)
		}
		if claims.TZ != "Asia/Manila" {
			t.Errorf("tz = %q, want the owner's Asia/Manila", claims.TZ)
		}
	})

	t.Run("a timezone that cannot be looked up is never guessed", func(t *testing.T) {
		iss := testIssuer(t)
		fail := UserLookupFunc(func(context.Context, uuid.UUID) (UserRecord, bool, error) {
			return UserRecord{}, false, errors.New("db down")
		})
		called := false
		next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })
		req := requestAsUser(httptest.NewRequest(http.MethodGet, "/api/budget/remaining", nil), userID)
		rec := httptest.NewRecorder()
		EdgeIdentity("corefinance", iss, nil, fail)(next).ServeHTTP(rec, req)
		if called || rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, proxied = %v; want 500, not proxied", rec.Code, called)
		}
	})
}
