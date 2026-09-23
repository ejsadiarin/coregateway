package auth

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// setupKeyDB spins a throwaway postgres, applies the gateway migrations'
// Up sections (minus the pg_uuidv7 extension, unavailable in the test
// image), and returns sqlc queries plus the raw pool for assertions.
func setupKeyDB(t *testing.T) (*db.Queries, *pgxpool.Pool) {
	t.Helper()
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
	for _, file := range migrationFiles(t) {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read migration: %v", err)
		}
		up := string(data)
		if idx := strings.Index(up, "-- +goose Down"); idx >= 0 {
			up = up[:idx]
		}
		// pg_uuidv7 is unavailable in the test image; pgcrypto's
		// gen_random_uuid covers the UUID defaults used here.
		up = strings.ReplaceAll(up, "CREATE EXTENSION IF NOT EXISTS pg_uuidv7;", "")
		up = strings.ReplaceAll(up, "CREATE SCHEMA IF NOT EXISTS coregateway;", "")
		if _, err := pool.Exec(ctx, up); err != nil {
			t.Fatalf("apply %s: %v", file, err)
		}
	}
	return db.New(pool), pool
}

func migrationFiles(t *testing.T) []string {
	t.Helper()
	dirs := []string{
		"../db/migrations",
		"internal/db/migrations",
		"../../internal/db/migrations",
	}
	var dir string
	for _, d := range dirs {
		if st, err := os.Stat(d); err == nil && st.IsDir() {
			dir = d
			break
		}
	}
	if dir == "" {
		t.Fatal("migrations directory not found")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read migrations: %v", err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, filepath.Join(dir, e.Name()))
		}
	}
	sort.Strings(files)
	return files
}

func TestApiKeyStorageHoldsHashOnly(t *testing.T) {
	queries, pool := setupKeyDB(t)
	svc := NewKeysService(queries)
	ctx := context.Background()

	owner := uuid.New()
	plaintext, row, err := svc.CreateKey(ctx, CreateKeyRequest{
		Label:   "ci",
		OwnerID: &owner,
		Scopes:  []string{"finance:read"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if plaintext == "" || row.ID == uuid.Nil {
		t.Fatal("expected plaintext and row id")
	}

	// Scan every column of the stored row: the digest must match
	// sha256(plaintext) and no column may contain the plaintext.
	var gotHash, gotPrefix, gotLabel string
	var gotOwner uuid.UUID
	err = pool.QueryRow(ctx,
		`SELECT key_hash, key_prefix, label, owner_user_id FROM coregateway.api_keys WHERE id = $1`,
		row.ID,
	).Scan(&gotHash, &gotPrefix, &gotLabel, &gotOwner)
	if err != nil {
		t.Fatalf("scan row: %v", err)
	}
	if gotOwner != owner {
		t.Errorf("owner = %v, want %v", gotOwner, owner)
	}
	if gotHash != HashAPIKey(plaintext) || len(gotHash) != 64 {
		t.Error("stored hash is not sha256(plaintext)")
	}
	for _, col := range []string{gotHash, gotPrefix, gotLabel} {
		if strings.Contains(col, plaintext) {
			t.Errorf("column contains plaintext: %q", col)
		}
	}

	// The created key validates.
	userID, keyID, scopes, err := svc.ValidateKey(ctx, plaintext)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if userID != owner || keyID != row.ID.String() || len(scopes) != 1 {
		t.Errorf("validated identity = %v %q %v", userID, keyID, scopes)
	}
}

func TestApiKeyRevocationTakesEffectImmediately(t *testing.T) {
	queries, _ := setupKeyDB(t)
	svc := NewKeysService(queries)
	ctx := context.Background()

	plaintext, row, err := svc.CreateKey(ctx, CreateKeyRequest{Label: "temp"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := svc.RevokeKey(ctx, row.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, _, _, err := svc.ValidateKey(ctx, plaintext); err != ErrInvalidKey {
		t.Errorf("revoked key validates: err = %v", err)
	}
	if err := svc.RevokeKey(ctx, row.ID); err != ErrKeyNotFound {
		t.Errorf("double revoke err = %v, want ErrKeyNotFound", err)
	}
	if err := svc.RevokeKey(ctx, uuid.New()); err != ErrKeyNotFound {
		t.Errorf("unknown revoke err = %v, want ErrKeyNotFound", err)
	}
}

func TestApiKeyExpiryRejects(t *testing.T) {
	queries, _ := setupKeyDB(t)
	svc := NewKeysService(queries)
	ctx := context.Background()

	past := time.Now().Add(-time.Hour)
	plaintext, _, err := svc.CreateKey(ctx, CreateKeyRequest{Label: "old", ExpiresAt: &past})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, _, _, err := svc.ValidateKey(ctx, plaintext); err != ErrInvalidKey {
		t.Errorf("expired key validates: err = %v", err)
	}
}

func TestApiKeyListExcludesSecrets(t *testing.T) {
	queries, _ := setupKeyDB(t)
	svc := NewKeysService(queries)
	ctx := context.Background()

	if _, _, err := svc.CreateKey(ctx, CreateKeyRequest{Label: "a"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	rows, err := svc.ListKeys(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	// ListApiKeysRow has no hash field by construction (compile-time
	// guarantee); assert the metadata is complete.
	if rows[0].Label != "a" || rows[0].KeyPrefix != ApiKeyPrefix {
		t.Errorf("row = %+v", rows[0])
	}
}
