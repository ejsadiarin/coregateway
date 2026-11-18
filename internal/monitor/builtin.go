package monitor

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
)

var (
	// ErrBuiltinService refuses deletion of a downstream the gateway owns.
	ErrBuiltinService = errors.New("built-in service can't be deleted; pause it instead")
	// ErrBuiltinURL refuses repointing a built-in; config owns its URL.
	ErrBuiltinURL = errors.New("built-in service URL is managed by the gateway")
)

// Builtin is one downstream entry the gateway ensures on every start.
type Builtin struct {
	Key         string
	Name        string
	URL         string
	Description string
	ServiceType string
}

// DownstreamBuiltins is the three services the gateway proxies to, using
// their configured bases and the /health route every one serves.
func DownstreamBuiltins(corefinance, coreban, coredraw string) []Builtin {
	health := func(base string) string { return strings.TrimRight(base, "/") + "/health" }
	return []Builtin{
		{Key: "corefinance", Name: "corefinance", URL: health(corefinance), Description: "Budget service", ServiceType: "downstream"},
		{Key: "coreban", Name: "coreban", URL: health(coreban), Description: "Notes and reminders service", ServiceType: "downstream"},
		{Key: "coredraw", Name: "coredraw", URL: health(coredraw), Description: "Drawing service", ServiceType: "downstream"},
	}
}

// EnsureBuiltinServices upserts each downstream by its stable key. It never
// duplicates an entry and leaves pause/tuning fields as the admin left them.
func EnsureBuiltinServices(ctx context.Context, queries sqlc.Querier, builtins []Builtin) error {
	for _, builtin := range builtins {
		if strings.TrimSpace(builtin.URL) == "" {
			return fmt.Errorf("built-in service %s has no URL", builtin.Key)
		}
		if _, err := queries.UpsertBuiltinService(ctx, sqlc.UpsertBuiltinServiceParams{
			Name:        builtin.Name,
			Url:         builtin.URL,
			Description: pgtype.Text{String: builtin.Description, Valid: builtin.Description != ""},
			ServiceType: pgtype.Text{String: builtin.ServiceType, Valid: builtin.ServiceType != ""},
			BuiltinKey:  pgtype.Text{String: builtin.Key, Valid: true},
		}); err != nil {
			return fmt.Errorf("upsert built-in service %s: %w", builtin.Key, err)
		}
	}
	return nil
}
