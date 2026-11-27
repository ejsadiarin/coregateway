package monitor

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
)

func builtinMigrationFiles(t *testing.T) []string {
	t.Helper()
	dirs := []string{"../db/migrations", "internal/db/migrations", "../../internal/db/migrations"}
	for _, dir := range dirs {
		files, err := filepath.Glob(filepath.Join(dir, "*.sql"))
		if err == nil && len(files) > 0 {
			return files
		}
	}
	t.Fatal("migrations directory not found")
	return nil
}

func setupBuiltinDB(t *testing.T) (*sqlc.Queries, *pgxpool.Pool) {
	t.Helper()
	if testing.Short() {
		t.Skip("short mode: integration test needs Docker (run `make test-integration`)")
	}
	ctx := context.Background()

	pgContainer, err := postgres.Run(ctx,
		"postgres:16-alpine",
		postgres.WithDatabase("coregateway_test"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if err := pgContainer.Terminate(ctx); err != nil {
			t.Fatalf("terminate postgres container: %v", err)
		}
	})

	connStr, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	t.Cleanup(pool.Close)

	if _, err := pool.Exec(ctx, "CREATE SCHEMA IF NOT EXISTS coregateway"); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	if _, err := pool.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS pgcrypto`); err != nil {
		t.Fatalf("create pgcrypto: %v", err)
	}
	for _, file := range builtinMigrationFiles(t) {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read migration: %v", err)
		}
		up := string(data)
		if idx := strings.Index(up, "-- +goose Down"); idx >= 0 {
			up = up[:idx]
		}
		up = strings.ReplaceAll(up, "CREATE EXTENSION IF NOT EXISTS pg_uuidv7;", "")
		up = strings.ReplaceAll(up, "CREATE SCHEMA IF NOT EXISTS coregateway;", "")
		if _, err := pool.Exec(ctx, up); err != nil {
			t.Fatalf("apply %s: %v", file, err)
		}
	}
	return sqlc.New(pool), pool
}

func TestEnsureBuiltinServices_Integration(t *testing.T) {
	queries, pool := setupBuiltinDB(t)
	ctx := context.Background()

	builtins := DownstreamBuiltins("http://finance:6969", "http://ban:6972", "http://draw:6971")
	if err := EnsureBuiltinServices(ctx, queries, builtins); err != nil {
		t.Fatalf("seed built-ins: %v", err)
	}
	assertBuiltinCount(t, ctx, pool, 3)

	// A restart upserts the same three rather than adding more.
	if err := EnsureBuiltinServices(ctx, queries, builtins); err != nil {
		t.Fatalf("reseed built-ins: %v", err)
	}
	assertBuiltinCount(t, ctx, pool, 3)

	// A config change moves the URL, and admin tuning survives.
	if _, err := pool.Exec(ctx,
		`UPDATE coregateway.services SET is_active = false, timeout = 2000 WHERE builtin_key = 'corefinance'`); err != nil {
		t.Fatalf("tune built-in: %v", err)
	}
	changed := DownstreamBuiltins("http://finance-new:6969", "http://ban:6972", "http://draw:6971")
	if err := EnsureBuiltinServices(ctx, queries, changed); err != nil {
		t.Fatalf("reseed changed built-ins: %v", err)
	}
	var url string
	var active bool
	var timeout int32
	if err := pool.QueryRow(ctx,
		`SELECT url, is_active, timeout FROM coregateway.services WHERE builtin_key = 'corefinance'`).
		Scan(&url, &active, &timeout); err != nil {
		t.Fatalf("read built-in: %v", err)
	}
	if url != "http://finance-new:6969/health" || active || timeout != 2000 {
		t.Errorf("built-in = %s active=%v timeout=%d, want new URL, paused, 2000ms", url, active, timeout)
	}

	// The built-in cannot be deleted or repointed.
	var id uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM coregateway.services WHERE builtin_key = 'corefinance'`).Scan(&id); err != nil {
		t.Fatalf("built-in id: %v", err)
	}
	svc := NewService(queries, NewStatuses())
	if err := svc.DeleteService(ctx, id); !errors.Is(err, ErrBuiltinService) {
		t.Errorf("delete built-in error = %v, want %v", err, ErrBuiltinService)
	}
	paused := false
	if _, err := svc.UpdateService(ctx, id, UpdateServiceRequest{
		URL:      ptr("http://elsewhere:9999"),
		IsActive: &paused,
	}); !errors.Is(err, ErrBuiltinURL) {
		t.Errorf("repoint built-in error = %v, want %v", err, ErrBuiltinURL)
	}

	// An ordinary service is still deletable.
	custom, err := queries.CreateService(ctx, sqlc.CreateServiceParams{
		Name:              "homelab",
		Url:               "http://homelab:8080/health",
		ServiceType:       pgtype.Text{String: "custom", Valid: true},
		HealthCheckMethod: pgtype.Text{String: "GET", Valid: true},
		Timeout:           pgtype.Int4{Int32: 5000, Valid: true},
	})
	if err != nil {
		t.Fatalf("create custom service: %v", err)
	}
	if err := svc.DeleteService(ctx, custom.ID); err != nil {
		t.Errorf("delete custom service: %v", err)
	}
}

func assertBuiltinCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, want int) {
	t.Helper()
	var got int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM coregateway.services WHERE is_builtin`).Scan(&got); err != nil {
		t.Fatalf("count built-ins: %v", err)
	}
	if got != want {
		t.Errorf("built-in count = %d, want %d", got, want)
	}
}

func ptr(s string) *string { return &s }
