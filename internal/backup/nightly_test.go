package backup

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"
)

var manila = mustZone("Asia/Manila")

func mustZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

func TestANightlyRunSkipsWhenTodaysNightlyExists(t *testing.T) {
	dir := t.TempDir()
	// 02:00 Manila on Nov 27 is 18:00 UTC on Nov 26.
	seed(t, dir, "coredb-nightly-20261126T180001Z-pg17.dump")
	later := time.Date(2026, 11, 27, 2, 5, 0, 0, manila)
	f := NewFolder(dir, fakeDump("new"), fixedMajor(17), clockAt(later))

	if _, err := f.StartNightly(context.Background()); !errors.Is(err, ErrNightlyTaken) {
		t.Errorf("StartNightly err = %v, want ErrNightlyTaken", err)
	}
	if got := len(dirNames(t, dir)); got != 1 {
		t.Errorf("folder has %d files, want 1", got)
	}
}

func TestANightlyRunGoesAheadWhenOnlyYesterdaysOrAManualExists(t *testing.T) {
	dir := t.TempDir()
	seed(t, dir,
		"coredb-nightly-20261125T180000Z-pg17.dump", // Nov 26 Manila: yesterday
		"coredb-manual-20261126T180500Z-pg17.dump",  // today, but manual
	)
	at := time.Date(2026, 11, 27, 2, 0, 0, 0, manila)
	f := NewFolder(dir, fakeDump("new"), fixedMajor(17), clockAt(at))

	done, err := f.StartNightly(context.Background())
	if err != nil {
		t.Fatalf("StartNightly: %v", err)
	}
	awaitBackup(t, done)
	if got := dirNames(t, dir); !slices.Contains(got, "coredb-nightly-20261126T180000Z-pg17.dump") {
		t.Errorf("no nightly for Nov 27 Manila in %v", got)
	}
}

func TestANightlyRunSkipsWhileAnotherBackupRuns(t *testing.T) {
	dir := t.TempDir()
	release := make(chan struct{})
	f := NewFolder(dir, blockingDump(release), fixedMajor(17), clockAt(time.Now()))
	done, err := f.Start(context.Background(), Manual)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.StartNightly(context.Background()); !errors.Is(err, ErrRunning) {
		t.Errorf("StartNightly err = %v, want ErrRunning", err)
	}
	close(release)
	awaitBackup(t, done)
}

// fakeTimer records each wait the loop asks for and lets the test fire it.
type fakeTimer struct {
	asked chan time.Duration
	fire  chan time.Time
}

func newFakeTimer() *fakeTimer {
	return &fakeTimer{asked: make(chan time.Duration), fire: make(chan time.Time)}
}

func (ft *fakeTimer) after(d time.Duration) <-chan time.Time {
	ft.asked <- d
	return ft.fire
}

func (ft *fakeTimer) nextWait(t *testing.T) time.Duration {
	t.Helper()
	select {
	case d := <-ft.asked:
		return d
	case <-time.After(5 * time.Second):
		t.Fatal("loop never asked to wait")
		return 0
	}
}

func TestTheNightlyLoopWaitsUntil0200ManilaAndTakesANightly(t *testing.T) {
	dir := t.TempDir()
	clock := &mutableClock{now: time.Date(2026, 11, 26, 20, 0, 0, 0, manila)}
	f := NewFolder(dir, fakeDump("new"), fixedMajor(17), clock.Now)
	timer := newFakeTimer()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() { f.runNightly(ctx, timer.after); close(stopped) }()

	if d := timer.nextWait(t); d != 6*time.Hour {
		t.Fatalf("first wait = %v, want 6h (20:00 to 02:00 Manila)", d)
	}
	clock.Advance(6 * time.Hour)
	timer.fire <- clock.Now()

	// The loop asks for the next wait only once the nightly has finished.
	if d := timer.nextWait(t); d != 24*time.Hour {
		t.Errorf("next wait = %v, want 24h", d)
	}
	want := []string{"coredb-nightly-20261126T180000Z-pg17.dump"}
	if got := dirNames(t, dir); !slices.Equal(got, want) {
		t.Errorf("folder = %v, want %v", got, want)
	}

	cancel()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("loop did not stop on cancel")
	}
}

func TestTheNightlyLoopKeepsGoingAfterAFailedNight(t *testing.T) {
	dir := t.TempDir()
	clock := &mutableClock{now: time.Date(2026, 11, 27, 1, 59, 0, 0, manila)}
	failing := func(context.Context, string) error { return errors.New("connection refused") }
	f := NewFolder(dir, failing, fixedMajor(17), clock.Now)
	timer := newFakeTimer()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go f.runNightly(ctx, timer.after)

	if d := timer.nextWait(t); d != time.Minute {
		t.Fatalf("first wait = %v, want 1m", d)
	}
	clock.Advance(time.Minute)
	timer.fire <- clock.Now()
	if d := timer.nextWait(t); d != 24*time.Hour {
		t.Errorf("wait after a failed night = %v, want 24h", d)
	}
}
