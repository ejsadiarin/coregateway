package backup

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// localPgDumpMajor is the major version of the pg_dump on PATH. pg_dump
// refuses servers newer than itself, so the test server matches it.
func localPgDumpMajor(t *testing.T) string {
	t.Helper()
	out, err := exec.Command("pg_dump", "--version").Output()
	if err != nil {
		t.Skip("pg_dump not on PATH")
	}
	m := regexp.MustCompile(`\) (\d+)`).FindStringSubmatch(string(out))
	if m == nil {
		t.Fatalf("unrecognised pg_dump --version: %q", out)
	}
	return m[1]
}

func TestPGDumpWritesARestorableBackup_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode: integration test needs Docker (run `make test-integration`)")
	}
	major := localPgDumpMajor(t)
	ctx := context.Background()

	pg, err := postgres.Run(ctx, "postgres:"+major+"-alpine",
		postgres.WithDatabase("coredb"),
		postgres.WithUsername("owner"),
		postgres.WithPassword("s3cret-pw"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(60*time.Second)),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = pg.Terminate(ctx) })

	url, err := pg.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `CREATE SCHEMA corefinance; CREATE TABLE corefinance.ledger (id int)`); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	f := NewFolder(dir, PGDump(url), ServerMajor(pool), time.Now)
	done, err := f.Start(ctx, Manual)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("backup: %v", err)
	}

	list, err := f.List()
	if err != nil || len(list) != 1 {
		t.Fatalf("List = %v, %v", list, err)
	}
	if want := "-pg" + major + ".dump"; !strings.HasSuffix(list[0].Name, want) {
		t.Errorf("name %q does not end in %q", list[0].Name, want)
	}
	toc, err := exec.Command("pg_restore", "--list", filepath.Join(dir, list[0].Name)).CombinedOutput()
	if err != nil {
		t.Fatalf("pg_restore --list: %v\n%s", err, toc)
	}
	if !strings.Contains(string(toc), "TABLE corefinance ledger") {
		t.Errorf("backup is missing corefinance.ledger:\n%s", toc)
	}
	if _, err := os.Stat(filepath.Join(dir, ".lock")); !os.IsNotExist(err) {
		t.Errorf("lock not released: %v", err)
	}
}

func TestPGDumpKeepsThePasswordOffTheCommandLine(t *testing.T) {
	cmd, err := pgDumpCmd(context.Background(),
		"postgresql://owner:s3cret-pw@db.example:5432/coredb?sslmode=require", "/backups/x.partial")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(cmd.Args, " "), "s3cret-pw") {
		t.Errorf("password in argv: %v", cmd.Args)
	}
	found := false
	for _, kv := range cmd.Env {
		if kv == "PGPASSWORD=s3cret-pw" {
			found = true
		}
	}
	if !found {
		t.Error("PGPASSWORD not set in the subprocess environment")
	}
}

func TestPGDumpErrorsNeverCarryTheOwnerCredentials(t *testing.T) {
	if _, err := exec.LookPath("pg_dump"); err != nil {
		t.Skip("pg_dump not on PATH")
	}
	// Nothing listens on port 1, so pg_dump fails to connect and reports
	// the connection it tried.
	const password = "s3cret-pw"
	ownerURL := "postgresql://owner:" + password + "@127.0.0.1:1/coredb?sslmode=disable&connect_timeout=2"
	err := PGDump(ownerURL)(context.Background(), filepath.Join(t.TempDir(), "x.partial"))
	if err == nil {
		t.Fatal("want a connection error")
	}
	msg := err.Error()
	if strings.Contains(msg, password) {
		t.Errorf("error carries the password: %s", msg)
	}
	if strings.Contains(msg, "postgresql://") {
		t.Errorf("error carries the connection string: %s", msg)
	}
	if !strings.Contains(msg, "127.0.0.1") {
		t.Errorf("error lost the useful part: %s", msg)
	}
	// A URL that is not even parseable must not be echoed either.
	err = PGDump("postgresql://owner:"+password+"@[bad")(context.Background(), "/nonexistent")
	if err == nil || strings.Contains(err.Error(), password) {
		t.Errorf("bad URL error = %v", err)
	}
}

func TestScrubRemovesTheOwnerURLAndPassword(t *testing.T) {
	owner := "postgresql://owner:s3cret-pw@db.example/coredb"
	msg := `could not connect to "postgresql://owner@db.example/coredb" with s3cret-pw`
	got := scrub(msg, owner)
	if strings.Contains(got, "s3cret-pw") || strings.Contains(got, "postgresql://") {
		t.Errorf("scrub = %q", got)
	}
}

func TestScrubLeavesTextAloneWhenAShortPasswordAppearsInsideOtherWords(t *testing.T) {
	owner := "postgresql://neondb_owner:owner@postgres:5432/coredb"
	msg := `password authentication failed for user "neondb_owner"`
	if got := scrub(msg, owner); got != msg {
		t.Errorf("scrub = %q, want the message unchanged", got)
	}
}
