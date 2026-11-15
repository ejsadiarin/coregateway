package user

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/ejsadiarin/coregateway/internal/auth"
	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/ejsadiarin/coregateway/internal/helper"
	"github.com/ejsadiarin/coregateway/internal/timezone"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	// ErrUserNotFound is a timezone read or write for a user who doesn't exist.
	ErrUserNotFound = errors.New("user not found")
	// ErrInvalidTimezone is a value that isn't an IANA zone.
	ErrInvalidTimezone = errors.New("timezone must be an IANA zone such as Asia/Manila")
)

// Timezone is a user's timezone as the API reports it. Saved is false while
// the user has none, in which case Timezone is timezone.Default (UTC); the
// web uses it to adopt the device's zone once.
type Timezone struct {
	UserID   string `json:"user_id"`
	Timezone string `json:"timezone"`
	Saved    bool   `json:"saved"`
}

// Timezone reads a user's timezone (ADR-0005).
func (s *Service) Timezone(ctx context.Context, id uuid.UUID) (Timezone, error) {
	u, err := s.db.GetUser(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Timezone{}, ErrUserNotFound
	}
	if err != nil {
		return Timezone{}, err
	}
	return timezoneOf(id, u.Timezone), nil
}

// SetTimezone saves a user's timezone after checking it is an IANA zone.
func (s *Service) SetTimezone(ctx context.Context, id uuid.UUID, tz string) (Timezone, error) {
	if !timezone.Valid(tz) {
		return Timezone{}, ErrInvalidTimezone
	}
	stored, err := s.db.SetUserTimezone(ctx, sqlc.SetUserTimezoneParams{ID: id, Timezone: pgtype.Text{String: tz, Valid: true}})
	if errors.Is(err, pgx.ErrNoRows) {
		return Timezone{}, ErrUserNotFound
	}
	if err != nil {
		return Timezone{}, err
	}
	return timezoneOf(id, stored), nil
}

func timezoneOf(id uuid.UUID, stored pgtype.Text) Timezone {
	return Timezone{UserID: id.String(), Timezone: timezone.Effective(stored), Saved: stored.Valid}
}

type setTimezoneRequest struct {
	Timezone string `json:"timezone"`
}

// ownTimezone parses the {id} a timezone route names and checks it is the
// caller's own: a user's timezone is theirs alone to read and set (no admin
// reads another's; downstream background work uses the zone it last saw in
// a request's tz claim, ADR-0005). It writes the refusal when it isn't.
func ownTimezone(w http.ResponseWriter, r *http.Request) (uuid.UUID, *auth.UserContext, bool) {
	id, ok := helper.ParseUUID(w, r, "id")
	if !ok {
		return uuid.Nil, nil, false
	}
	caller := auth.GetUserFromContext(r)
	if caller == nil {
		helper.RespondErrorJSON(w, http.StatusUnauthorized, "Authentication required")
		return uuid.Nil, nil, false
	}
	if caller.ID != id {
		helper.RespondErrorJSON(w, http.StatusForbidden, "Access denied")
		return uuid.Nil, nil, false
	}
	return id, caller, true
}

// GetTimezone serves GET /api/users/{id}/timezone: the caller's own.
func (h *Handler) GetTimezone(w http.ResponseWriter, r *http.Request) {
	id, _, ok := ownTimezone(w, r)
	if !ok {
		return
	}
	tz, err := h.service.Timezone(r.Context(), id)
	if errors.Is(err, ErrUserNotFound) {
		helper.RespondErrorJSON(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		slog.Error("user.Handler.GetTimezone: failed", "error", err, "id", id)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to get timezone")
		return
	}
	helper.RespondJSON(w, http.StatusOK, tz)
}

// SetTimezone serves PUT /api/users/{id}/timezone: only the user sets
// their own. The demo guest is shared by anyone who can reach the login
// page, so it keeps the default rather than one visitor's zone.
func (h *Handler) SetTimezone(w http.ResponseWriter, r *http.Request) {
	id, caller, ok := ownTimezone(w, r)
	if !ok {
		return
	}
	if caller.Role == auth.RoleGuest {
		helper.RespondErrorJSON(w, http.StatusForbidden, "demo accounts can't set a timezone")
		return
	}
	var req setTimezoneRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		helper.RespondErrorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	tz, err := h.service.SetTimezone(r.Context(), id, req.Timezone)
	switch {
	case errors.Is(err, ErrInvalidTimezone):
		helper.RespondErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	case errors.Is(err, ErrUserNotFound):
		helper.RespondErrorJSON(w, http.StatusNotFound, err.Error())
		return
	case err != nil:
		slog.Error("user.Handler.SetTimezone: failed", "error", err, "id", id)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to save timezone")
		return
	}
	slog.Info("user.Handler.SetTimezone: timezone saved", "id", id, "timezone", tz.Timezone)
	helper.RespondJSON(w, http.StatusOK, tz)
}
