package auth

import (
	"context"
	"errors"
	"testing"

	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// A user's timezone lives on the gateway user (ADR-0005): unset reads as
// UTC, a saved zone is what the gateway mints into the tz claim, and the
// table refuses the two non-zones Go's LoadLocation would accept.
func TestUserTimezoneStorage_Integration(t *testing.T) {
	queries, _ := setupKeyDB(t)
	svc := NewService(queries)
	ctx := context.Background()

	u, err := queries.CreateUser(ctx, db.CreateUserParams{Email: "tz@example.com", Role: RoleUser})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	rec, err := svc.LookupUser(ctx, u.ID)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if rec != (UserRecord{Role: RoleUser, Timezone: "UTC"}) {
		t.Errorf("unset: %+v, want user in UTC", rec)
	}

	if _, err := queries.SetUserTimezone(ctx, db.SetUserTimezoneParams{ID: u.ID, Timezone: pgtype.Text{String: "Asia/Manila", Valid: true}}); err != nil {
		t.Fatalf("set timezone: %v", err)
	}
	if rec, _ := svc.LookupUser(ctx, u.ID); rec.Timezone != "Asia/Manila" {
		t.Errorf("saved: tz %q, want Asia/Manila", rec.Timezone)
	}

	for _, bad := range []string{"", "Local"} {
		if _, err := queries.SetUserTimezone(ctx, db.SetUserTimezoneParams{ID: u.ID, Timezone: pgtype.Text{String: bad, Valid: true}}); err == nil {
			t.Errorf("stored %q; the table must refuse it", bad)
		}
	}

	if _, err := queries.SetUserTimezone(ctx, db.SetUserTimezoneParams{ID: uuid.New(), Timezone: pgtype.Text{String: "UTC", Valid: true}}); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("unknown user: err = %v, want pgx.ErrNoRows", err)
	}
	if _, err := svc.LookupUser(ctx, uuid.New()); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("unknown user lookup: err = %v, want pgx.ErrNoRows", err)
	}
}
