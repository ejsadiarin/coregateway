package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ejsadiarin/coregateway/internal/auth"
	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/ejsadiarin/coregateway/internal/token"
	"github.com/ejsadiarin/coregateway/internal/user"
)

func (q *keyAuthStubQuerier) SetUserTimezone(_ context.Context, arg db.SetUserTimezoneParams) (pgtype.Text, error) {
	u := q.users[arg.ID]
	u.Timezone = arg.Timezone
	q.users[arg.ID] = u
	return arg.Timezone, nil
}

// idOf returns the id of the stub's (only) user with role.
func (q *keyAuthStubQuerier) idOf(role string) uuid.UUID {
	for id, u := range q.users {
		if u.Role == role {
			return id
		}
	}
	return uuid.Nil
}

// anyUserQuerier knows every id as a plain user without a timezone, for
// proxy tests whose sessions name arbitrary users.
type anyUserQuerier struct{ db.Querier }

func (anyUserQuerier) GetUser(_ context.Context, id uuid.UUID) (db.CoregatewayUser, error) {
	return db.CoregatewayUser{ID: id, Email: "user@example.com", Role: auth.RoleUser}, nil
}

// Keys a downstream background job might hold to look a user's timezone up.
const (
	testAdminOwnedFinanceAdminKey = "test-admin-owned-corefinance-admin-key"
	testUserOwnedBanAdminKey      = "test-user-owned-coreban-admin-key"
)

type timezoneBody struct {
	UserID   string `json:"user_id"`
	Timezone string `json:"timezone"`
	Saved    bool   `json:"saved"`
}

// timezoneSetup is the budget proxy plus the native user routes over one
// stub store, so a saved timezone is observable in the minted token.
func timezoneSetup(t *testing.T) (http.Handler, func(role string, id uuid.UUID) http.Handler, func() token.Claims, uuid.UUID, uuid.UUID) {
	t.Helper()
	s, q, fake := budgetScopeSetup(t)
	s.UserHandler = user.NewHandler(user.NewService(q))
	adminID, userID := q.idOf(auth.RoleAdmin), q.idOf(auth.RoleUser)
	q.keyByHash[auth.HashAPIKey(testAdminOwnedFinanceAdminKey)] = db.CoregatewayApiKey{ID: uuid.New(), OwnerUserID: adminID, Scopes: []string{"corefinance:admin"}}
	q.keyByHash[auth.HashAPIKey(testUserOwnedBanAdminKey)] = db.CoregatewayApiKey{ID: uuid.New(), OwnerUserID: userID, Scopes: []string{"coreban:admin"}}
	as := func(role string, id uuid.UUID) http.Handler { return proxyRouter(s, role, id) }
	proxied := func() token.Claims {
		_, _, authHeader, _ := fake.snapshot()
		return parseDownstreamToken(t, s.TokenIssuer, authHeader)
	}
	return as("", uuid.Nil), as, proxied, adminID, userID
}

func decodeTimezone(t *testing.T, rec *httptest.ResponseRecorder) timezoneBody {
	t.Helper()
	var body timezoneBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return body
}

func TestUserTimezone(t *testing.T) {
	t.Run("a user without a timezone reads UTC, not saved", func(t *testing.T) {
		_, as, _, _, userID := timezoneSetup(t)
		rec := doKeyRequest(t, as(auth.RoleUser, userID), "", http.MethodGet, "/api/users/"+userID.String()+"/timezone", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body)
		}
		got := decodeTimezone(t, rec)
		if got.Timezone != "UTC" || got.Saved || got.UserID != userID.String() {
			t.Errorf("body = %+v, want UTC, not saved, for %s", got, userID)
		}
	})

	t.Run("a user sets their timezone and reads it back", func(t *testing.T) {
		_, as, _, _, userID := timezoneSetup(t)
		h := as(auth.RoleUser, userID)
		rec := doKeyRequest(t, h, "", http.MethodPut, "/api/users/"+userID.String()+"/timezone", `{"timezone":"Asia/Manila"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("PUT status = %d, want 200 (%s)", rec.Code, rec.Body)
		}
		if got := decodeTimezone(t, rec); got.Timezone != "Asia/Manila" || !got.Saved {
			t.Errorf("PUT body = %+v, want Asia/Manila saved", got)
		}
		rec = doKeyRequest(t, h, "", http.MethodGet, "/api/users/"+userID.String()+"/timezone", "")
		if got := decodeTimezone(t, rec); got.Timezone != "Asia/Manila" || !got.Saved {
			t.Errorf("GET body = %+v, want Asia/Manila saved", got)
		}
	})

	t.Run("values that aren't IANA zones are rejected", func(t *testing.T) {
		_, as, _, _, userID := timezoneSetup(t)
		h := as(auth.RoleUser, userID)
		for _, tz := range []string{"", "Local", "Mars/Olympus_Mons", "+08:00"} {
			rec := doKeyRequest(t, h, "", http.MethodPut, "/api/users/"+userID.String()+"/timezone", `{"timezone":"`+tz+`"}`)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("PUT %q status = %d, want 400", tz, rec.Code)
			}
		}
		rec := doKeyRequest(t, h, "", http.MethodGet, "/api/users/"+userID.String()+"/timezone", "")
		if got := decodeTimezone(t, rec); got.Saved {
			t.Errorf("a rejected value was stored: %+v", got)
		}
	})

	t.Run("a user cannot read or set someone else's timezone", func(t *testing.T) {
		_, as, _, adminID, userID := timezoneSetup(t)
		h := as(auth.RoleUser, userID)
		if rec := doKeyRequest(t, h, "", http.MethodGet, "/api/users/"+adminID.String()+"/timezone", ""); rec.Code != http.StatusForbidden {
			t.Errorf("GET other status = %d, want 403", rec.Code)
		}
		if rec := doKeyRequest(t, h, "", http.MethodPut, "/api/users/"+adminID.String()+"/timezone", `{"timezone":"Asia/Manila"}`); rec.Code != http.StatusForbidden {
			t.Errorf("PUT other status = %d, want 403", rec.Code)
		}
	})

	t.Run("an admin cannot set someone else's timezone", func(t *testing.T) {
		_, as, _, adminID, userID := timezoneSetup(t)
		rec := doKeyRequest(t, as(auth.RoleAdmin, adminID), "", http.MethodPut, "/api/users/"+userID.String()+"/timezone", `{"timezone":"Asia/Manila"}`)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("no credential is 401", func(t *testing.T) {
		anon, _, _, _, userID := timezoneSetup(t)
		if rec := doKeyRequest(t, anon, "", http.MethodGet, "/api/users/"+userID.String()+"/timezone", ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("status = %d, want 401", rec.Code)
		}
	})
}

// The saved timezone reaches downstream in the internal token's tz claim:
// the caller's, or the target user's in a targeted read (ADR-0005).
func TestProxiedTokenCarriesSavedTimezone(t *testing.T) {
	_, as, proxied, adminID, userID := timezoneSetup(t)
	put := func(id uuid.UUID, role, tz string) {
		t.Helper()
		rec := doKeyRequest(t, as(role, id), "", http.MethodPut, "/api/users/"+id.String()+"/timezone", `{"timezone":"`+tz+`"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("PUT status = %d (%s)", rec.Code, rec.Body)
		}
	}

	if rec := doKeyRequest(t, as(auth.RoleUser, userID), "", http.MethodGet, "/api/budget/remaining", ""); rec.Code != http.StatusOK {
		t.Fatalf("proxy status = %d", rec.Code)
	}
	if got := proxied().TZ; got != "UTC" {
		t.Errorf("unset: tz = %q, want UTC", got)
	}

	put(userID, auth.RoleUser, "Asia/Manila")
	put(adminID, auth.RoleAdmin, "Europe/Berlin")

	doKeyRequest(t, as(auth.RoleUser, userID), "", http.MethodGet, "/api/budget/remaining", "")
	if got := proxied().TZ; got != "Asia/Manila" {
		t.Errorf("caller: tz = %q, want Asia/Manila", got)
	}

	doKeyRequest(t, as(auth.RoleAdmin, adminID), "", http.MethodGet, "/api/budget/remaining?user_id="+userID.String(), "")
	claims := proxied()
	if claims.ActAs != userID.String() || claims.TZ != "Asia/Manila" {
		t.Errorf("targeted read: act_as = %q tz = %q, want %s in Asia/Manila", claims.ActAs, claims.TZ, userID)
	}

	doKeyRequest(t, as(auth.RoleAdmin, adminID), "", http.MethodGet, "/api/budget/remaining", "")
	if got := proxied().TZ; got != "Europe/Berlin" {
		t.Errorf("admin's own read: tz = %q, want Europe/Berlin", got)
	}
}

// A downstream background job has no internal token; it looks a user's
// timezone up with an admin-owned key holding a downstream admin scope.
func TestUserTimezoneLookupForBackgroundJobs(t *testing.T) {
	t.Run("admin-owned downstream admin key reads any user's timezone", func(t *testing.T) {
		anon, as, _, _, userID := timezoneSetup(t)
		doKeyRequest(t, as(auth.RoleUser, userID), "", http.MethodPut, "/api/users/"+userID.String()+"/timezone", `{"timezone":"Asia/Manila"}`)
		rec := doKeyRequest(t, anon, testAdminOwnedFinanceAdminKey, http.MethodGet, "/api/users/"+userID.String()+"/timezone", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body)
		}
		if got := decodeTimezone(t, rec); got.Timezone != "Asia/Manila" || !got.Saved {
			t.Errorf("body = %+v, want Asia/Manila saved", got)
		}
	})

	t.Run("an unset timezone is a 200, not an error", func(t *testing.T) {
		anon, _, _, _, userID := timezoneSetup(t)
		rec := doKeyRequest(t, anon, testAdminOwnedFinanceAdminKey, http.MethodGet, "/api/users/"+userID.String()+"/timezone", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if got := decodeTimezone(t, rec); got.Timezone != "UTC" || got.Saved {
			t.Errorf("body = %+v, want UTC, not saved", got)
		}
	})

	t.Run("an unknown user is 404", func(t *testing.T) {
		anon, _, _, _, _ := timezoneSetup(t)
		rec := doKeyRequest(t, anon, testAdminOwnedFinanceAdminKey, http.MethodGet, "/api/users/"+uuid.NewString()+"/timezone", "")
		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("a non-admin owner's downstream admin key cannot read others", func(t *testing.T) {
		anon, _, _, adminID, _ := timezoneSetup(t)
		rec := doKeyRequest(t, anon, testUserOwnedBanAdminKey, http.MethodGet, "/api/users/"+adminID.String()+"/timezone", "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("an admin-owned read key cannot read others", func(t *testing.T) {
		anon, _, _, _, userID := timezoneSetup(t)
		rec := doKeyRequest(t, anon, testAdminReadKeyPlaintext, http.MethodGet, "/api/users/"+userID.String()+"/timezone", "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})

	t.Run("a lookup key cannot set a timezone", func(t *testing.T) {
		anon, _, _, _, userID := timezoneSetup(t)
		rec := doKeyRequest(t, anon, testAdminOwnedFinanceAdminKey, http.MethodPut, "/api/users/"+userID.String()+"/timezone", `{"timezone":"Asia/Manila"}`)
		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", rec.Code)
		}
	})
}
