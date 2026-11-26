package backup

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/ejsadiarin/coregateway/internal/helper"
)

// Handler serves the admin backup routes. A nil folder means backups are
// not configured (no owner connection): listing says so and triggering
// answers 503, while the rest of the gateway runs normally.
type Handler struct {
	folder *Folder
}

func NewHandler(folder *Folder) *Handler { return &Handler{folder: folder} }

type listResponse struct {
	Configured  bool     `json:"configured"`
	Running     bool     `json:"running"`
	Backups     []Backup `json:"backups"`
	LastFailure *Failure `json:"last_failure"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if h.folder == nil {
		helper.RespondJSON(w, http.StatusOK, listResponse{Backups: []Backup{}})
		return
	}
	backups, err := h.folder.List()
	if err != nil {
		slog.Error("backup.Handler.List: failed", "error", err)
		// Admin-only: the real problem (a missing mount, wrong owner) is what
		// the admin needs to fix it.
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "could not read the backup folder: "+err.Error())
		return
	}
	lastFailure, err := h.folder.LastFailure()
	if err != nil {
		// A broken failure record must not hide the backups themselves.
		slog.Warn("backup.Handler.List: could not read the last failure", "error", err)
	}
	helper.RespondJSON(w, http.StatusOK, listResponse{
		Configured:  true,
		Running:     h.folder.Running(),
		Backups:     backups,
		LastFailure: lastFailure,
	})
}

// Trigger starts a manual backup and answers 202 once the lock is held; the
// dump outlives the request, so it runs on a background context.
func (h *Handler) Trigger(w http.ResponseWriter, r *http.Request) {
	if h.folder == nil {
		helper.RespondErrorJSON(w, http.StatusServiceUnavailable, "backups are not configured")
		return
	}
	done, err := h.folder.Start(context.Background(), Manual)
	if errors.Is(err, ErrRunning) {
		helper.RespondErrorJSON(w, http.StatusConflict, err.Error())
		return
	}
	if err != nil {
		slog.Error("backup.Handler.Trigger: failed to start", "error", err)
		// Admin-only, and never carries credentials: the real cause helps.
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "could not start a backup: "+err.Error())
		return
	}
	slog.Info("backup: manual backup started")
	go func() {
		if err := <-done; err != nil {
			slog.Error("backup: manual backup failed", "error", err)
			return
		}
		slog.Info("backup: manual backup finished")
	}()
	helper.RespondJSON(w, http.StatusAccepted, map[string]string{"status": "started"})
}
