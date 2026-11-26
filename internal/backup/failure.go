package backup

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// Failure is the last failed backup, kept in the folder (never the
// database) until a backup succeeds.
type Failure struct {
	FailedAt time.Time `json:"failed_at"`
	Kind     Kind      `json:"kind"`
	Error    string    `json:"error"`
}

const failureName = "last-failure.json"

// LastFailure returns the last failure since the last success, or nil. It
// is the newer of the failure file and this replica's in-memory copy (the
// only record when the folder cannot be written), and is dropped once a
// backup newer than it exists, so another replica's success clears it too.
func (f *Folder) LastFailure() (*Failure, error) {
	fromFile, fileErr := f.readFailureFile()
	f.mu.Lock()
	failure := f.failed
	f.mu.Unlock()
	if fromFile != nil && (failure == nil || fromFile.FailedAt.After(failure.FailedAt)) {
		failure = fromFile
	}
	if failure == nil {
		return nil, fileErr
	}
	// An unreadable folder keeps the failure shown: that is likely the problem.
	// Backup names carry whole seconds, so a backup from the failure's own
	// second counts as newer: a backup takes longer than a second, so it
	// cannot have finished before the failure within that second.
	if backups, err := f.List(); err == nil && len(backups) > 0 &&
		!backups[0].TakenAt.Before(failure.FailedAt.Truncate(time.Second)) {
		return nil, nil
	}
	return failure, nil
}

func (f *Folder) readFailureFile() (*Failure, error) {
	b, err := os.ReadFile(filepath.Join(f.dir, failureName))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var failure Failure
	if err := json.Unmarshal(b, &failure); err != nil {
		return nil, fmt.Errorf("read %s: %w", failureName, err)
	}
	return &failure, nil
}

// record records an outcome (nil for a success), logging when the folder
// cannot hold it; the in-memory copy is kept either way.
func (f *Folder) record(kind Kind, outcome error) {
	if err := f.recordOutcome(kind, outcome); err != nil {
		slog.Warn("backup: could not record the outcome in the folder", "error", err)
	}
}

// recordOutcome records the failure of a run, or clears the last one after
// a success, in memory and in the folder. The file is written aside and
// renamed, so a reader never sees half of it.
func (f *Folder) recordOutcome(kind Kind, runErr error) error {
	path := filepath.Join(f.dir, failureName)
	if runErr == nil {
		f.mu.Lock()
		f.failed = nil
		f.mu.Unlock()
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		return nil
	}
	failure := Failure{FailedAt: f.now().UTC(), Kind: kind, Error: runErr.Error()}
	f.mu.Lock()
	f.failed = &failure
	f.mu.Unlock()
	b, err := json.Marshal(failure)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
