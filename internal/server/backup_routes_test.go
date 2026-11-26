package server

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/backup"
	"github.com/ejsadiarin/coregateway/internal/config"
	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
)

// backupRoutesSetup serves the real route table with backups taken into a
// temp folder by a dump that blocks until release is closed. A nil release
// means backups are not configured.
func backupRoutesSetup(t *testing.T, release chan struct{}) (http.Handler, uuid.UUID, uuid.UUID) {
	t.Helper()
	adminID, userID := uuid.New(), uuid.New()
	q := &keyAuthStubQuerier{
		users: map[uuid.UUID]db.CoregatewayUser{
			adminID: {ID: adminID, Email: "admin@example.com", Role: auth.RoleAdmin},
			userID:  {ID: userID, Email: "user@example.com", Role: auth.RoleUser},
		},
		keyByHash: map[string]db.CoregatewayApiKey{
			auth.HashAPIKey(testAdminKeyPlaintext): {ID: uuid.New(), OwnerUserID: adminID, Scopes: []string{"admin"}},
			auth.HashAPIKey(testWriteKeyPlaintext): {ID: uuid.New(), OwnerUserID: adminID, Scopes: []string{"corefinance:write"}},
		},
	}
	var folder *backup.Folder
	if release != nil {
		dump := func(ctx context.Context, dst string) error {
			<-release
			return os.WriteFile(dst, []byte("dump"), 0o600)
		}
		major := func(context.Context) (int, error) { return 17, nil }
		folder = backup.NewFolder(t.TempDir(), dump, major, time.Now)
		t.Cleanup(func() {
			// Let a running dump finish before the temp folder is removed.
			select {
			case <-release:
			default:
				close(release)
			}
			for folder.Running() {
				time.Sleep(time.Millisecond)
			}
		})
	}
	authSvc := auth.NewService(q)
	keysSvc := auth.NewKeysService(q)
	s := &Server{
		AuthService:   authSvc,
		KeysService:   keysSvc,
		BackupHandler: backup.NewHandler(folder),
	}
	return s.RegisterRoutes(&config.Config{}), adminID, userID
}

type backupsBody struct {
	Configured bool            `json:"configured"`
	Running    bool            `json:"running"`
	Backups    []backup.Backup `json:"backups"`
}

func decodeBackups(t *testing.T, body []byte) backupsBody {
	t.Helper()
	var b backupsBody
	if err := json.Unmarshal(body, &b); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return b
}

func TestAdminTriggersABackupAndSeesItListed(t *testing.T) {
	release := make(chan struct{})
	h, adminID, _ := backupRoutesSetup(t, release)

	rec := doSessionRequest(t, h, adminID, auth.RoleAdmin, http.MethodPost, "/api/admin/backups", "")
	if rec.Code != http.StatusAccepted {
		t.Fatalf("trigger status = %d, want 202 (%s)", rec.Code, rec.Body)
	}

	rec = doSessionRequest(t, h, adminID, auth.RoleAdmin, http.MethodPost, "/api/admin/backups", "")
	if rec.Code != http.StatusConflict {
		t.Errorf("second trigger status = %d, want 409", rec.Code)
	}

	rec = doSessionRequest(t, h, adminID, auth.RoleAdmin, http.MethodGet, "/api/admin/backups", "")
	if got := decodeBackups(t, rec.Body.Bytes()); !got.Configured || !got.Running || len(got.Backups) != 0 {
		t.Errorf("while running = %+v", got)
	}

	close(release)
	deadline := time.Now().Add(5 * time.Second)
	for {
		rec = doSessionRequest(t, h, adminID, auth.RoleAdmin, http.MethodGet, "/api/admin/backups", "")
		got := decodeBackups(t, rec.Body.Bytes())
		if !got.Running && len(got.Backups) == 1 {
			if got.Backups[0].Kind != backup.Manual {
				t.Errorf("kind = %q, want manual", got.Backups[0].Kind)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("backup never listed: %+v", got)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestBackupRoutesAreAdminOnly(t *testing.T) {
	h, _, userID := backupRoutesSetup(t, make(chan struct{}))
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		if rec := doSessionRequest(t, h, userID, auth.RoleUser, method, "/api/admin/backups", ""); rec.Code != http.StatusForbidden {
			t.Errorf("user %s status = %d, want 403", method, rec.Code)
		}
		// An admin-owned key without `admin` cover is refused too.
		if rec := doKeyRequest(t, h, testWriteKeyPlaintext, method, "/api/admin/backups", ""); rec.Code != http.StatusForbidden {
			t.Errorf("non-admin-scope key %s status = %d, want 403", method, rec.Code)
		}
		if rec := doKeyRequest(t, h, "", method, "/api/admin/backups", ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("anonymous %s status = %d, want 401", method, rec.Code)
		}
	}
	if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/admin/backups", ""); rec.Code != http.StatusOK {
		t.Errorf("admin key GET status = %d, want 200", rec.Code)
	}
}

func TestBackupsReportNotConfiguredWithoutTheOwnerConnection(t *testing.T) {
	h, adminID, _ := backupRoutesSetup(t, nil)

	rec := doSessionRequest(t, h, adminID, auth.RoleAdmin, http.MethodGet, "/api/admin/backups", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200", rec.Code)
	}
	if got := decodeBackups(t, rec.Body.Bytes()); got.Configured || len(got.Backups) != 0 {
		t.Errorf("unconfigured list = %+v", got)
	}
	if rec := doSessionRequest(t, h, adminID, auth.RoleAdmin, http.MethodPost, "/api/admin/backups", ""); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("trigger status = %d, want 503", rec.Code)
	}
}
