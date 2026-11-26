package backup

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"testing"
	"time"
)

// seed puts completed backup files in dir, as earlier runs would have.
func seed(t *testing.T, dir string, names ...string) {
	t.Helper()
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	sort.Strings(out)
	return out
}

func TestAFourthBackupRemovesTheOldestByTheTimeInItsName(t *testing.T) {
	dir := t.TempDir()
	// Mixed kinds, so name order ("manual" < "nightly") differs from time
	// order: the oldest is a nightly, which sorts after every manual.
	seed(t, dir,
		"coredb-nightly-20261123T180000Z-pg17.dump", // oldest
		"coredb-manual-20261124T090000Z-pg17.dump",
		"coredb-nightly-20261125T180000Z-pg17.dump",
	)
	at := time.Date(2026, 11, 26, 18, 0, 0, 0, time.UTC)
	f := NewFolder(dir, fakeDump("new"), fixedMajor(17), clockAt(at))

	done, err := f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatal(err)
	}
	awaitBackup(t, done)

	want := []string{
		"coredb-manual-20261124T090000Z-pg17.dump",
		"coredb-manual-20261126T180000Z-pg17.dump",
		"coredb-nightly-20261125T180000Z-pg17.dump",
	}
	if got := dirNames(t, dir); !slices.Equal(got, want) {
		t.Errorf("folder = %v\nwant     %v", got, want)
	}
}

func TestAFailedBackupRemovesNothing(t *testing.T) {
	dir := t.TempDir()
	existing := []string{
		"coredb-manual-20261122T090000Z-pg17.dump",
		"coredb-nightly-20261123T180000Z-pg17.dump",
		"coredb-nightly-20261124T180000Z-pg17.dump",
		"coredb-nightly-20261125T180000Z-pg17.dump",
	}
	seed(t, dir, existing...)
	failing := func(context.Context, string) error { return errors.New("connection refused") }
	f := NewFolder(dir, failing, fixedMajor(17), clockAt(time.Now()))

	done, err := f.Start(context.Background(), Nightly)
	if err != nil {
		t.Fatal(err)
	}
	if err := <-done; err == nil {
		t.Fatal("want the dump error")
	}
	if got := dirNames(t, dir); !slices.Equal(got, existing) {
		t.Errorf("folder = %v\nwant     %v", got, existing)
	}
}

func TestLeftoverPartialsAreRemovedOnTheNextRun(t *testing.T) {
	dir := t.TempDir()
	seed(t, dir, "coredb-nightly-20261125T180000Z-pg17.dump.partial")
	at := time.Date(2026, 11, 26, 18, 0, 0, 0, time.UTC)
	f := NewFolder(dir, fakeDump("new"), fixedMajor(17), clockAt(at))

	done, err := f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatal(err)
	}
	awaitBackup(t, done)

	want := []string{"coredb-manual-20261126T180000Z-pg17.dump"}
	if got := dirNames(t, dir); !slices.Equal(got, want) {
		t.Errorf("folder = %v, want %v", got, want)
	}
}

func TestTheBackupJustTakenIsKeptEvenIfItsClockRunsBehind(t *testing.T) {
	dir := t.TempDir()
	// Another replica, with a clock ahead of this one, wrote these.
	seed(t, dir,
		"coredb-nightly-20261127T180000Z-pg17.dump",
		"coredb-nightly-20261128T180000Z-pg17.dump",
		"coredb-nightly-20261129T180000Z-pg17.dump",
	)
	behind := time.Date(2026, 11, 26, 18, 0, 0, 0, time.UTC)
	f := NewFolder(dir, fakeDump("new"), fixedMajor(17), clockAt(behind))

	done, err := f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatal(err)
	}
	awaitBackup(t, done)

	want := []string{
		"coredb-manual-20261126T180000Z-pg17.dump",
		"coredb-nightly-20261128T180000Z-pg17.dump",
		"coredb-nightly-20261129T180000Z-pg17.dump",
	}
	if got := dirNames(t, dir); !slices.Equal(got, want) {
		t.Errorf("folder = %v\nwant     %v", got, want)
	}
}
