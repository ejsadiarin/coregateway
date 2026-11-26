package backup

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
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

// LastFailure returns the last failure since the last success, or nil.
func (f *Folder) LastFailure() (*Failure, error) {
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

// recordOutcome writes the failure of a run, or clears the last one after a
// success. Called while the run still holds the lock. The file is written
// aside and renamed, so a reader never sees half of it.
func (f *Folder) recordOutcome(kind Kind, runErr error) error {
	path := filepath.Join(f.dir, failureName)
	if runErr == nil {
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		return nil
	}
	b, err := json.Marshal(Failure{FailedAt: f.now().UTC(), Kind: kind, Error: runErr.Error()})
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
