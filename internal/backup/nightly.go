package backup

import (
	"context"
	"errors"
	"log/slog"
	"time"
	_ "time/tzdata" // the gateway image has no system zoneinfo
)

// NightlyZone and NightlyHour place the nightly backup: 02:00 in Manila.
// Fixed in code, so there is nothing to configure.
const (
	NightlyZone = "Asia/Manila"
	NightlyHour = 2
)

var nightlyLoc = func() *time.Location {
	loc, err := time.LoadLocation(NightlyZone)
	if err != nil {
		panic(err) // embedded by time/tzdata, so never in practice
	}
	return loc
}()

// ErrNightlyTaken means today's nightly backup already exists, typically
// taken by another replica sharing the folder.
var ErrNightlyTaken = errors.New("today's nightly backup already exists")

// StartNightly begins today's nightly backup unless one already exists for
// today's Manila date (ErrNightlyTaken) or another backup holds the lock
// (ErrRunning). With two replicas waking at 02:00, one runs and the other
// skips, whether it wakes during the run or after it.
func (f *Folder) StartNightly(ctx context.Context) (<-chan error, error) {
	return f.start(ctx, Nightly, func() error {
		backups, err := f.List()
		if err != nil {
			return err
		}
		today := manilaDate(f.now())
		for _, b := range backups {
			if b.Kind == Nightly && manilaDate(b.TakenAt) == today {
				return ErrNightlyTaken
			}
		}
		return nil
	})
}

func manilaDate(t time.Time) string { return t.In(nightlyLoc).Format("2006-01-02") }

// RunNightly takes a nightly backup at 02:00 Manila every day until ctx is
// done. A night missed while the gateway was down is not made up.
func (f *Folder) RunNightly(ctx context.Context) { f.runNightly(ctx, time.After) }

func (f *Folder) runNightly(ctx context.Context, after func(time.Duration) <-chan time.Time) {
	for {
		now := f.now()
		select {
		case <-ctx.Done():
			return
		case <-after(nextNightly(now).Sub(now)):
		}
		f.takeNightly(ctx)
	}
}

// takeNightly runs one nightly backup to the end, logging the outcome.
func (f *Folder) takeNightly(ctx context.Context) {
	done, err := f.StartNightly(ctx)
	switch {
	case isSkip(err):
		slog.Info("backup: nightly skipped", "reason", err)
		return
	case err != nil:
		slog.Error("backup: nightly failed to start", "error", err)
		return
	}
	if err := <-done; err != nil {
		slog.Error("backup: nightly failed", "error", err)
		return
	}
	slog.Info("backup: nightly finished")
}

// nextNightly is the first 02:00 Manila strictly after now.
func nextNightly(now time.Time) time.Time {
	local := now.In(nightlyLoc)
	next := time.Date(local.Year(), local.Month(), local.Day(), NightlyHour, 0, 0, 0, nightlyLoc)
	if !next.After(local) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}
