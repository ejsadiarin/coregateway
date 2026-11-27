package export

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/helper"
)

// Account is the gateway's own part: who the data belongs to, for
// reference. It is export-only: importing a file never changes who you
// are or your timezone.
var Account = Part{
	Name: "account", Format: "coregateway.account", ExportPath: "/api/account/export", ExportOnly: true,
}

const AccountSchema = "https://raw.githubusercontent.com/ejsadiarin/coregateway/main/schemas/account.v1.json"

type AccountPart struct {
	Schema     string      `json:"$schema"`
	Format     string      `json:"format"`
	Version    int         `json:"version"`
	ExportedAt time.Time   `json:"exported_at"`
	Source     PartSource  `json:"source"`
	Data       AccountData `json:"data"`
}

type PartSource struct {
	Service string `json:"service"`
}

// AccountData holds no credentials: no password, API keys or sessions.
type AccountData struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	Timezone  string    `json:"timezone"`
	CreatedAt string    `json:"created_at"`
}

// AccountLookup is a user's account as the part shows it; found is false
// for no such user.
type AccountLookup func(ctx context.Context, id uuid.UUID) (data AccountData, found bool, err error)

// AccountExport serves GET /api/account/export: the caller's account, or,
// for an admin session with ?user_id=, that user's.
func AccountExport(lookup AccountLookup, now func() time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller := auth.GetUserFromContext(r)
		id := caller.ID
		if raw := r.URL.Query().Get("user_id"); raw != "" {
			target, err := uuid.Parse(raw)
			if err != nil {
				helper.RespondErrorJSON(w, http.StatusBadRequest, "invalid user_id")
				return
			}
			_, isKey := auth.KeyScopesFromContext(r)
			if target != caller.ID && (caller.Role != auth.RoleAdmin || (isKey && !auth.KeyHasScope(r, "admin"))) {
				helper.RespondErrorJSON(w, http.StatusForbidden, "Insufficient permissions")
				return
			}
			id = target
		}
		data, found, err := lookup(r.Context(), id)
		if err != nil {
			slog.Error("export: account lookup failed", "error", err)
			helper.RespondErrorJSON(w, http.StatusInternalServerError, "couldn't read the account")
			return
		}
		if !found {
			helper.RespondErrorJSON(w, http.StatusNotFound, "target user not found")
			return
		}
		helper.RespondJSON(w, http.StatusOK, AccountPart{Schema: AccountSchema, Format: Account.Format, Version: 1,
			ExportedAt: now().UTC().Truncate(time.Second), Source: PartSource{Service: "coregateway"}, Data: data})
	}
}
