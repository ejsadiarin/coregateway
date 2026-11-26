package backup

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PGDump returns a DumpFunc that runs pg_dump in custom format against
// ownerURL, the owner connection (MIGRATION_URL). Per ADR-0006 the owner
// credentials go only to this subprocess: no shell, fixed arguments, and the
// password travels in PGPASSWORD rather than on the command line.
func PGDump(ownerURL string) DumpFunc {
	return func(ctx context.Context, dst string) error {
		cmd, err := pgDumpCmd(ctx, ownerURL, dst)
		if err != nil {
			return err
		}
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			if msg := strings.TrimSpace(stderr.String()); msg != "" {
				return fmt.Errorf("%w: %s", err, msg)
			}
			return err
		}
		return nil
	}
}

func pgDumpCmd(ctx context.Context, ownerURL, dst string) (*exec.Cmd, error) {
	u, err := url.Parse(ownerURL)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		// Never echo the URL: it carries the owner password.
		return nil, fmt.Errorf("owner connection is not a postgres:// URL")
	}
	password, _ := u.User.Password()
	u.User = url.User(u.User.Username())

	cmd := exec.CommandContext(ctx, "pg_dump",
		"--format=custom",
		"--no-password",
		"--file="+dst,
		"--dbname="+u.String(),
	)
	cmd.Env = append(os.Environ(), "PGPASSWORD="+password)
	return cmd, nil
}

// ServerMajor reads the server's major version over the gateway's own
// runtime pool, which reaches the same server as the owner connection.
func ServerMajor(pool *pgxpool.Pool) MajorFunc {
	return func(ctx context.Context) (int, error) {
		var num string
		if err := pool.QueryRow(ctx, "SHOW server_version_num").Scan(&num); err != nil {
			return 0, err
		}
		n, err := strconv.Atoi(num)
		if err != nil {
			return 0, fmt.Errorf("server_version_num %q: %w", num, err)
		}
		return n / 10000, nil
	}
}
