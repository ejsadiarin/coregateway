package monitor

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/ejsadiarin/coregateway/internal/helper"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) CreateService(w http.ResponseWriter, r *http.Request) {
	var req CreateServiceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		helper.RespondErrorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	slog.Debug("monitor.Handler.CreateService: request received", "name", req.Name)
	service, err := h.service.CreateService(r.Context(), req)
	if err != nil {
		slog.Error("monitor.Handler.CreateService: failed", "error", err)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("monitor.Handler.CreateService: service created", "id", service.ID)
	helper.RespondJSON(w, http.StatusCreated, service)
}

func (h *Handler) ListServices(w http.ResponseWriter, r *http.Request) {
	slog.Debug("monitor.Handler.ListServices: request received")
	services, err := h.service.ListServices(r.Context())
	if err != nil {
		slog.Error("monitor.Handler.ListServices: failed", "error", err)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Debug("monitor.Handler.ListServices: success", "count", len(services))
	helper.RespondJSON(w, http.StatusOK, services)
}

func (h *Handler) GetService(w http.ResponseWriter, r *http.Request) {
	id, ok := helper.ParseUUID(w, r, "id")
	if !ok {
		return
	}
	slog.Debug("monitor.Handler.GetService: request received", "id", id)
	service, err := h.service.GetService(r.Context(), id)
	if err != nil {
		slog.Error("monitor.Handler.GetService: failed", "error", err, "id", id)
		if err.Error() == "service not found" {
			helper.RespondErrorJSON(w, http.StatusNotFound, "service not found")
			return
		}
		helper.RespondErrorJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Debug("monitor.Handler.GetService: success", "id", id)
	helper.RespondJSON(w, http.StatusOK, service)
}

func (h *Handler) UpdateService(w http.ResponseWriter, r *http.Request) {
	id, ok := helper.ParseUUID(w, r, "id")
	if !ok {
		return
	}
	var req UpdateServiceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		helper.RespondErrorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	slog.Debug("monitor.Handler.UpdateService: request received", "id", id)
	service, err := h.service.UpdateService(r.Context(), id, req)
	if err != nil {
		slog.Error("monitor.Handler.UpdateService: failed", "error", err, "id", id)
		if err.Error() == "service not found" {
			helper.RespondErrorJSON(w, http.StatusNotFound, "service not found")
			return
		}
		helper.RespondErrorJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("monitor.Handler.UpdateService: service updated", "id", id)
	helper.RespondJSON(w, http.StatusOK, service)
}

func (h *Handler) DeleteService(w http.ResponseWriter, r *http.Request) {
	id, ok := helper.ParseUUID(w, r, "id")
	if !ok {
		return
	}
	slog.Debug("monitor.Handler.DeleteService: request received", "id", id)
	err := h.service.DeleteService(r.Context(), id)
	if err != nil {
		slog.Error("monitor.Handler.DeleteService: failed", "error", err, "id", id)
		if err.Error() == "service not found" {
			helper.RespondErrorJSON(w, http.StatusNotFound, "service not found")
			return
		}
		helper.RespondErrorJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Info("monitor.Handler.DeleteService: service deleted", "id", id)
	helper.RespondJSON(w, http.StatusNoContent, nil)
}

func (h *Handler) GetServiceHistory(w http.ResponseWriter, r *http.Request) {
	id, ok := helper.ParseUUID(w, r, "id")
	if !ok {
		return
	}
	slog.Debug("monitor.Handler.GetServiceHistory: request received", "id", id)
	history, err := h.service.GetServiceHistory(r.Context(), id, 100)
	if err != nil {
		slog.Error("monitor.Handler.GetServiceHistory: failed", "error", err, "id", id)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Debug("monitor.Handler.GetServiceHistory: success", "id", id, "count", len(history))
	helper.RespondJSON(w, http.StatusOK, history)
}

func (h *Handler) GetServiceStats(w http.ResponseWriter, r *http.Request) {
	id, ok := helper.ParseUUID(w, r, "id")
	if !ok {
		return
	}
	slog.Debug("monitor.Handler.GetServiceStats: request received", "id", id)
	stats, err := h.service.GetServiceStats(r.Context(), id)
	if err != nil {
		slog.Error("monitor.Handler.GetServiceStats: failed", "error", err, "id", id)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Debug("monitor.Handler.GetServiceStats: success", "id", id)
	helper.RespondJSON(w, http.StatusOK, stats)
}

func (h *Handler) GetAllServicesStats(w http.ResponseWriter, r *http.Request) {
	slog.Debug("monitor.Handler.GetAllServicesStats: request received")
	stats, err := h.service.GetAllServiceStats(r.Context())
	if err != nil {
		slog.Error("monitor.Handler.GetAllServicesStats: failed", "error", err)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, err.Error())
		return
	}
	slog.Debug("monitor.Handler.GetAllServicesStats: success")
	helper.RespondJSON(w, http.StatusOK, stats)
}
