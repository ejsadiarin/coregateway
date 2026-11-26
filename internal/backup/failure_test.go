package backup

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestAFailedBackupIsRecordedAndTheNextSuccessClearsIt(t *testing.T) {
	dir := t.TempDir()
	at := time.Date(2026, 11, 26, 18, 0, 0, 0, time.UTC)
	fail := true
	dump := func(ctx context.Context, dst string) error {
		if fail {
			return errors.New("connection refused")
		}
		return fakeDump("ok")(ctx, dst)
	}
	f := NewFolder(dir, dump, fixedMajor(17), clockAt(at))

	if got, err := f.LastFailure(); err != nil || got != nil {
		t.Fatalf("before any run: LastFailure = %+v, %v; want none", got, err)
	}

	done, err := f.Start(context.Background(), Nightly)
	if err != nil {
		t.Fatal(err)
	}
	if err := <-done; err == nil {
		t.Fatal("want the dump error")
	}
	got, err := f.LastFailure()
	if err != nil || got == nil {
		t.Fatalf("after a failure: LastFailure = %+v, %v", got, err)
	}
	if got.Kind != Nightly || !got.FailedAt.Equal(at) || got.Error != "pg_dump: connection refused" {
		t.Errorf("failure = %+v", got)
	}
	// The failure file is not a backup.
	if list, _ := f.List(); len(list) != 0 {
		t.Errorf("List = %+v, want empty", list)
	}

	fail = false
	done, err = f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatal(err)
	}
	awaitBackup(t, done)
	if got, err := f.LastFailure(); err != nil || got != nil {
		t.Errorf("after a success: LastFailure = %+v, %v; want none", got, err)
	}
}

func TestABackupStoppedByShutdownIsNotRecordedAsAFailure(t *testing.T) {
	dir := t.TempDir()
	started := make(chan struct{})
	untilCancelled := func(ctx context.Context, dst string) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	f := NewFolder(dir, untilCancelled, fixedMajor(17), clockAt(time.Now()))
	ctx, cancel := context.WithCancel(context.Background())

	done, err := f.StartNightly(ctx)
	if err != nil {
		t.Fatal(err)
	}
	<-started
	cancel() // the server shuts down mid-dump
	if err := <-done; err == nil {
		t.Fatal("want the cancellation error")
	}
	if got, err := f.LastFailure(); err != nil || got != nil {
		t.Errorf("LastFailure = %+v, %v; want none after a shutdown", got, err)
	}
	if f.Running() {
		t.Error("lock still held after a shutdown")
	}
}

// unwritableFolder returns a backup folder the gateway cannot write to, as
// with a bind mount owned by the wrong user.
func unwritableFolder(t *testing.T) string {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })
	return dir
}

func TestANightlyThatCannotStartShowsAsTheLastFailure(t *testing.T) {
	dir := unwritableFolder(t)
	clock := &mutableClock{now: time.Date(2026, 11, 27, 1, 59, 0, 0, manila)}
	f := NewFolder(dir, fakeDump("x"), fixedMajor(17), clock.Now)
	timer := newFakeTimer()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go f.runNightly(ctx, timer.after)

	timer.nextWait(t)
	clock.Advance(time.Minute)
	timer.fire <- clock.Now()
	timer.nextWait(t) // the night is over

	got, err := f.LastFailure()
	if err != nil || got == nil {
		t.Fatalf("LastFailure = %+v, %v; want the start failure", got, err)
	}
	if got.Kind != Nightly || !strings.Contains(got.Error, "permission denied") {
		t.Errorf("failure = %+v, want a nightly permission error", got)
	}
}

func TestAManualBackupThatCannotStartShowsAsTheLastFailureUntilASuccess(t *testing.T) {
	dir := unwritableFolder(t)
	f := NewFolder(dir, fakeDump("x"), fixedMajor(17), clockAt(time.Now()))

	if _, err := f.Start(context.Background(), Manual); err == nil {
		t.Fatal("want a start error")
	}
	got, _ := f.LastFailure()
	if got == nil || got.Kind != Manual || !strings.Contains(got.Error, "permission denied") {
		t.Fatalf("LastFailure = %+v", got)
	}

	if err := os.Chmod(dir, 0o700); err != nil { // the admin fixes the mount
		t.Fatal(err)
	}
	done, err := f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatal(err)
	}
	awaitBackup(t, done)
	if got, err := f.LastFailure(); err != nil || got != nil {
		t.Errorf("after a success: LastFailure = %+v, %v", got, err)
	}
}

func TestAnotherReplicasSuccessInTheSameSecondClearsTheFailure(t *testing.T) {
	dir := t.TempDir()
	failedAt := time.Date(2026, 11, 26, 18, 0, 0, 700_000_000, time.UTC)
	failing := func(context.Context, string) error { return errors.New("connection refused") }
	a := NewFolder(dir, failing, fixedMajor(17), clockAt(failedAt))
	done, err := a.Start(context.Background(), Manual)
	if err != nil {
		t.Fatal(err)
	}
	<-done

	// Replica B succeeds a moment later, within the same second.
	b := NewFolder(dir, fakeDump("ok"), fixedMajor(17), clockAt(failedAt.Add(200*time.Millisecond)))
	done, err = b.Start(context.Background(), Manual)
	if err != nil {
		t.Fatal(err)
	}
	awaitBackup(t, done)

	if got, err := a.LastFailure(); err != nil || got != nil {
		t.Errorf("replica A still shows %+v, %v", got, err)
	}
}
