package backup

import (
	"context"
	"errors"
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
