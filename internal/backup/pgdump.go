package backup

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"regexp"
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
			// The error is shown on the Backups page: pg_dump does not echo
			// the password today, but scrub it and the URL in case it ever does.
			if msg := scrub(strings.TrimSpace(stderr.String()), ownerURL); msg != "" {
				return fmt.Errorf("%w: %s", err, msg)
			}
			return err
		}
		return nil
	}
}

// scrub removes the owner URL (with or without its password) and the
// password itself from msg. The password is matched only as a whole token,
// so a short one that also occurs inside another word (a user name, say)
// does not mangle the message.
func scrub(msg, ownerURL string) string {
	msg = strings.ReplaceAll(msg, ownerURL, "[redacted]")
	u, err := url.Parse(ownerURL)
	if err != nil {
		return msg
	}
	password, ok := u.User.Password()
	if !ok || password == "" {
		return msg
	}
	u.User = url.User(u.User.Username())
	msg = strings.ReplaceAll(msg, u.String(), "[redacted]")
	wholePassword := regexp.MustCompile(`(^|[^A-Za-z0-9_])` + regexp.QuoteMeta(password) + `($|[^A-Za-z0-9_])`)
	return wholePassword.ReplaceAllString(msg, "${1}[redacted]${2}")
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
