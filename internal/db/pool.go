package db

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool creates a new PostgreSQL connection pool
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database URL: %w", err)
	}
	// Unnamed statements with client-side cached descriptions, rather than
	// named prepared statements. The database sits behind a PgBouncer pooler
	// that shares named statements between clients by query text, so after
	// a migration changes a result type, a statement prepared before it
	// keeps failing ("cached plan must not change result type") until the
	// pooler's server connection closes, and restarting the gateway can't
	// clear it. A URL that sets default_query_exec_mode still wins.
	if !strings.Contains(databaseURL, "default_query_exec_mode") {
		poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheDescribe
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return pool, nil
}
