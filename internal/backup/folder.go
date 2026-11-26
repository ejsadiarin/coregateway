// Package backup takes backups of the shared database into a folder that is
// the only record of them (ADR-0006): every file names its kind, UTC time
// and server major version, and coordination between gateway replicas uses
// files in the same folder, never the database.
package backup

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"time"
)

// Kind says why a backup was taken.
type Kind string

const (
	Nightly Kind = "nightly"
	Manual  Kind = "manual"
)

// Backup is one completed backup file.
type Backup struct {
	Name        string    `json:"name"`
	Kind        Kind      `json:"kind"`
	TakenAt     time.Time `json:"taken_at"`
	SizeBytes   int64     `json:"size_bytes"`
	ServerMajor int       `json:"server_major"`
}

// DumpFunc writes a backup of the whole database to dst.
type DumpFunc func(ctx context.Context, dst string) error

// MajorFunc reports the database server's major version.
type MajorFunc func(ctx context.Context) (int, error)

// Dir is where the gateway keeps backups: a bind mount under compose, a
// shared ReadWriteMany volume under k3s. Fixed, so there is nothing to set.
const Dir = "/backups"

const timeLayout = "20060102T150405Z"

var nameRE = regexp.MustCompile(`^coredb-(nightly|manual)-(\d{8}T\d{6}Z)-pg(\d+)\.dump$`)

// Folder takes and lists backups in one directory.
type Folder struct {
	dir   string
	dump  DumpFunc
	major MajorFunc
	now   func() time.Time
}

func NewFolder(dir string, dump DumpFunc, major MajorFunc, now func() time.Time) *Folder {
	return &Folder{dir: dir, dump: dump, major: major, now: now}
}

func fileName(kind Kind, at time.Time, major int) string {
	return fmt.Sprintf("coredb-%s-%s-pg%d.dump", kind, at.UTC().Format(timeLayout), major)
}

// ErrRunning means another backup holds the lock, in this replica or another
// one sharing the folder.
var ErrRunning = errors.New("a backup is already running")

const lockName = ".lock"

// staleAfter is how long a lock may go without a heartbeat before it is taken
// to belong to a replica that died mid-backup.
const staleAfter = time.Hour

// heartbeatEvery is how often a running backup refreshes its lock, so a
// healthy dump longer than staleAfter is never taken over. A var for tests.
var heartbeatEvery = 10 * time.Minute

// Start takes the lock and begins a backup of the given kind, returning
// ErrRunning if another backup holds the lock. The dump runs in the
// background on ctx; done receives its result exactly once, after the lock
// is released.
func (f *Folder) Start(ctx context.Context, kind Kind) (done <-chan error, err error) {
	if err := os.MkdirAll(f.dir, 0o750); err != nil {
		return nil, fmt.Errorf("backup folder: %w", err)
	}
	token, err := f.lock()
	if err != nil {
		return nil, err
	}
	ch := make(chan error, 1)
	go func() {
		stop := make(chan struct{})
		beat := make(chan struct{})
		go func() { f.heartbeat(token, stop); close(beat) }()
		err := f.run(ctx, kind)
		close(stop)
		<-beat
		f.unlock(token)
		ch <- err
	}()
	return ch, nil
}

// Running reports whether a backup holds a live lock.
func (f *Folder) Running() bool {
	_, touched, ok := f.readLock(f.lockPath())
	return ok && !f.stale(touched)
}

func (f *Folder) lockPath() string { return filepath.Join(f.dir, lockName) }

// lock creates the lock file exclusively (atomic on local disks and NFSv4)
// holding a token only this run knows, and returns that token. A stale lock
// is taken over by renaming it aside first, so two replicas that both see
// it stale cannot both win.
func (f *Folder) lock() (string, error) {
	token, err := newToken()
	if err != nil {
		return "", err
	}
	path := f.lockPath()
	for attempt := 0; attempt < 2; attempt++ {
		err := f.create(path, token)
		if err == nil {
			return token, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return "", err
		}
		staleToken, touched, ok := f.readLock(path)
		if ok && !f.stale(touched) {
			return "", ErrRunning
		}
		if ok {
			if err := f.takeOver(path, staleToken, token); err != nil {
				return "", err
			}
		}
	}
	return "", ErrRunning
}

// takeOver moves a stale lock aside. Rename is atomic, so only one replica
// gets the file; if what it got is not the stale lock it judged (another
// replica already replaced it with a fresh one), it puts that lock back.
func (f *Folder) takeOver(path, staleToken, token string) error {
	aside := path + ".stale-" + token
	if err := os.Rename(path, aside); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil // someone else moved it; retry the create
		}
		return fmt.Errorf("clear stale backup lock: %w", err)
	}
	got, _, _ := f.readLock(aside)
	if got != staleToken {
		// Link fails if a lock exists again, so this never clobbers one.
		_ = os.Link(aside, path)
		_ = os.Remove(aside)
		return ErrRunning
	}
	_ = os.Remove(aside)
	return nil
}

func (f *Folder) create(path, token string) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if errors.Is(err, fs.ErrExist) {
			return err
		}
		return fmt.Errorf("take backup lock: %w", err)
	}
	_, werr := file.WriteString(token)
	cerr := file.Close()
	terr := os.Chtimes(path, f.now(), f.now())
	if err := errors.Join(werr, cerr, terr); err != nil {
		_ = os.Remove(path)
		return fmt.Errorf("write backup lock: %w", err)
	}
	return nil
}

// heartbeat refreshes the lock's modification time while this run owns it.
func (f *Folder) heartbeat(token string, stop <-chan struct{}) {
	ticker := time.NewTicker(heartbeatEvery)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if got, _, ok := f.readLock(f.lockPath()); !ok || got != token {
				return
			}
			_ = os.Chtimes(f.lockPath(), f.now(), f.now())
		}
	}
}

// unlock removes the lock only if this run still owns it.
func (f *Folder) unlock(token string) {
	if got, _, ok := f.readLock(f.lockPath()); ok && got == token {
		_ = os.Remove(f.lockPath())
	}
}

// readLock returns a lock file's token and when it was last refreshed (its
// modification time).
func (f *Folder) readLock(path string) (token string, touched time.Time, ok bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", time.Time{}, false
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", time.Time{}, false
	}
	return string(b), info.ModTime(), true
}

func (f *Folder) stale(touched time.Time) bool { return f.now().Sub(touched) > staleAfter }

func newToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("lock token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

func (f *Folder) run(ctx context.Context, kind Kind) error {
	major, err := f.major(ctx)
	if err != nil {
		return fmt.Errorf("server version: %w", err)
	}
	final := filepath.Join(f.dir, fileName(kind, f.now(), major))
	partial := final + ".partial"
	// Create the file owner-only before pg_dump opens it (pg_dump keeps an
	// existing file's mode), and enforce it after in case the dump replaced it.
	// A backup holds password hashes and every user's data.
	if err := os.WriteFile(partial, nil, 0o600); err != nil {
		return fmt.Errorf("create backup file: %w", err)
	}
	if err := f.dump(ctx, partial); err != nil {
		_ = os.Remove(partial)
		return fmt.Errorf("pg_dump: %w", err)
	}
	if err := os.Chmod(partial, 0o600); err != nil {
		_ = os.Remove(partial)
		return fmt.Errorf("restrict backup file: %w", err)
	}
	if err := os.Rename(partial, final); err != nil {
		_ = os.Remove(partial)
		return fmt.Errorf("finish backup: %w", err)
	}
	return nil
}

// List returns the completed backups, newest first. Partial files and
// anything not named like a backup are ignored.
func (f *Folder) List() ([]Backup, error) {
	entries, err := os.ReadDir(f.dir)
	if errors.Is(err, fs.ErrNotExist) {
		return []Backup{}, nil // nothing taken yet
	}
	if err != nil {
		return nil, err
	}
	out := []Backup{}
	for _, e := range entries {
		m := nameRE.FindStringSubmatch(e.Name())
		if m == nil || !e.Type().IsRegular() {
			continue
		}
		at, err := time.Parse(timeLayout, m[2])
		if err != nil {
			continue
		}
		major, _ := strconv.Atoi(m[3])
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, Backup{
			Name:        e.Name(),
			Kind:        Kind(m[1]),
			TakenAt:     at,
			SizeBytes:   info.Size(),
			ServerMajor: major,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TakenAt.After(out[j].TakenAt) })
	return out, nil
}
