package backup

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// fakeDump stands in for pg_dump: it writes body to the destination path,
// creating it world-readable as pg_dump does under the default umask.
func fakeDump(body string) DumpFunc {
	return func(_ context.Context, dst string) error {
		return os.WriteFile(dst, []byte(body), 0o644)
	}
}

func fixedMajor(major int) MajorFunc {
	return func(context.Context) (int, error) { return major, nil }
}

func clockAt(t time.Time) func() time.Time { return func() time.Time { return t } }

func awaitBackup(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("backup failed: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("backup did not finish")
	}
}

func TestManualBackupIsListedWithKindTimeAndSize(t *testing.T) {
	dir := t.TempDir()
	at := time.Date(2026, 11, 26, 18, 4, 5, 0, time.UTC)
	f := NewFolder(dir, fakeDump("dump-bytes"), fixedMajor(17), clockAt(at))

	done, err := f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	awaitBackup(t, done)

	list, err := f.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("got %d backups, want 1", len(list))
	}
	b := list[0]
	if b.Name != "coredb-manual-20261126T180405Z-pg17.dump" {
		t.Errorf("Name = %q", b.Name)
	}
	if b.Kind != Manual || !b.TakenAt.Equal(at) || b.SizeBytes != int64(len("dump-bytes")) || b.ServerMajor != 17 {
		t.Errorf("backup = %+v", b)
	}
	info, err := os.Stat(filepath.Join(dir, b.Name))
	if err != nil {
		t.Fatalf("file missing: %v", err)
	}
	// A backup holds password hashes and every user's data: owner-only.
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("mode = %o, want 600", mode)
	}
}

// blockingDump writes a partial file, then waits for release before returning.
func blockingDump(release <-chan struct{}) DumpFunc {
	return func(_ context.Context, dst string) error {
		if err := os.WriteFile(dst, []byte("half"), 0o600); err != nil {
			return err
		}
		<-release
		return nil
	}
}

func TestSecondBackupIsRefusedWhileOneRuns(t *testing.T) {
	dir := t.TempDir()
	release := make(chan struct{})
	f := NewFolder(dir, blockingDump(release), fixedMajor(17), clockAt(time.Now()))

	done, err := f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatalf("first Start: %v", err)
	}
	if !f.Running() {
		t.Error("Running() = false during a backup")
	}
	if _, err := f.Start(context.Background(), Manual); !errors.Is(err, ErrRunning) {
		t.Errorf("second Start err = %v, want ErrRunning", err)
	}
	// Another replica sharing the folder is refused too.
	other := NewFolder(dir, fakeDump("x"), fixedMajor(17), clockAt(time.Now()))
	if _, err := other.Start(context.Background(), Manual); !errors.Is(err, ErrRunning) {
		t.Errorf("other replica Start err = %v, want ErrRunning", err)
	}

	list, _ := f.List()
	if len(list) != 0 {
		t.Errorf("in-progress backup listed: %+v", list)
	}

	close(release)
	awaitBackup(t, done)
	if f.Running() {
		t.Error("Running() = true after the backup finished")
	}
	again, err := f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatalf("Start after finish: %v", err)
	}
	awaitBackup(t, again)
}

func TestLockLeftByACrashedReplicaIsTakenOverAfterAnHour(t *testing.T) {
	now := time.Date(2026, 11, 26, 18, 0, 0, 0, time.UTC)
	cases := []struct {
		name    string
		takenAt time.Time
		wantErr error
	}{
		{"fresh lock blocks", now.Add(-30 * time.Minute), ErrRunning},
		{"stale lock is taken over", now.Add(-61 * time.Minute), nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			lock := filepath.Join(dir, ".lock")
			if err := os.WriteFile(lock, []byte("crashed-replica"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chtimes(lock, tc.takenAt, tc.takenAt); err != nil {
				t.Fatal(err)
			}
			f := NewFolder(dir, fakeDump("x"), fixedMajor(17), clockAt(now))
			if got := f.Running(); got != (tc.wantErr != nil) {
				t.Errorf("Running() = %v", got)
			}
			done, err := f.Start(context.Background(), Manual)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("Start err = %v, want %v", err, tc.wantErr)
			}
			if err == nil {
				awaitBackup(t, done)
				if list, _ := f.List(); len(list) != 1 {
					t.Errorf("got %d backups, want 1", len(list))
				}
			}
		})
	}
}

func TestFailedDumpLeavesNoFileAndReleasesTheLock(t *testing.T) {
	dir := t.TempDir()
	failing := func(_ context.Context, dst string) error {
		_ = os.WriteFile(dst, []byte("half"), 0o600)
		return errors.New("connection refused")
	}
	f := NewFolder(dir, failing, fixedMajor(17), clockAt(time.Now()))

	done, err := f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := <-done; err == nil {
		t.Fatal("want the dump error")
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.Name() != failureName { // the failure record is expected
			t.Errorf("left behind: %s", e.Name())
		}
	}
	if f.Running() {
		t.Error("lock still held after a failure")
	}
}

// mutableClock is a test clock that can be moved forward.
type mutableClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *mutableClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *mutableClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func TestALongBackupKeepsItsLockFresh(t *testing.T) {
	old := heartbeatEvery
	heartbeatEvery = 5 * time.Millisecond
	t.Cleanup(func() { heartbeatEvery = old })

	dir := t.TempDir()
	clock := &mutableClock{now: time.Date(2026, 11, 26, 18, 0, 0, 0, time.UTC)}
	release := make(chan struct{})
	f := NewFolder(dir, blockingDump(release), fixedMajor(17), clock.Now)
	done, err := f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatal(err)
	}
	clock.Advance(2 * time.Hour)
	time.Sleep(50 * time.Millisecond) // several heartbeats

	other := NewFolder(dir, fakeDump("x"), fixedMajor(17), clock.Now)
	if _, err := other.Start(context.Background(), Manual); !errors.Is(err, ErrRunning) {
		t.Errorf("a running two-hour backup was taken over: err = %v", err)
	}
	close(release)
	awaitBackup(t, done)
}

func TestFinishingBackupLeavesAnotherReplicasLockAlone(t *testing.T) {
	dir := t.TempDir()
	release := make(chan struct{})
	f := NewFolder(dir, blockingDump(release), fixedMajor(17), clockAt(time.Now()))
	done, err := f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatal(err)
	}
	// Another replica took the lock over in the meantime.
	lock := filepath.Join(dir, ".lock")
	if err := os.WriteFile(lock, []byte("other-replica"), 0o600); err != nil {
		t.Fatal(err)
	}
	close(release)
	awaitBackup(t, done)
	if b, err := os.ReadFile(lock); err != nil || string(b) != "other-replica" {
		t.Errorf("other replica's lock = %q, %v; want it untouched", b, err)
	}
}

func TestListingAMissingFolderIsEmpty(t *testing.T) {
	f := NewFolder(filepath.Join(t.TempDir(), "absent"), fakeDump("x"), fixedMajor(17), time.Now)
	list, err := f.List()
	if err != nil || len(list) != 0 {
		t.Errorf("List = %v, %v; want empty", list, err)
	}
}
