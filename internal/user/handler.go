package user

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/helper"
)

type CreateUserRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

type UpdateUserRequest struct {
	Email    *string `json:"email,omitempty"`
	Password *string `json:"password,omitempty"`
	Role     *string `json:"role,omitempty"`
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	slog.Debug("user.Handler.ListUsers: request received")
	users, err := h.service.ListUsers(r.Context())
	if err != nil {
		slog.Error("user.Handler.ListUsers: failed", "error", err)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to list users")
		return
	}
	slog.Debug("user.Handler.ListUsers: success", "count", len(users))
	helper.RespondJSON(w, http.StatusOK, users)
}

func (h *Handler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		helper.RespondErrorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	slog.Debug("user.Handler.CreateUser: request received", "email", req.Email)
	user, err := h.service.CreateUser(r.Context(), req.Email, req.Password, req.Role)
	if err != nil {
		slog.Error("user.Handler.CreateUser: failed", "error", err, "email", req.Email)
		if err.Error() == "user with this email already exists" {
			helper.RespondErrorJSON(w, http.StatusConflict, err.Error())
		} else {
			helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to create user")
		}
		return
	}
	slog.Info("user.Handler.CreateUser: user created", "email", req.Email)
	helper.RespondJSON(w, http.StatusCreated, user)
}

func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
	id, ok := helper.ParseUUID(w, r, "id")
	if !ok {
		return
	}

	caller := auth.GetUserFromContext(r)
	if caller == nil {
		helper.RespondErrorJSON(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	isAdmin := caller.Role == auth.RoleAdmin
	isSelf := caller.ID == id

	if !isAdmin && !isSelf {
		helper.RespondErrorJSON(w, http.StatusForbidden, "Access denied")
		return
	}

	// Key-authed callers need the admin scope to reach other users;
	// self-reads stay scope-free (owner-bound, no excess privilege).
	if !isSelf {
		if scopes, ok := auth.KeyScopesFromContext(r); ok && !auth.KeyCoversScope(scopes, "admin") {
			helper.RespondErrorJSON(w, http.StatusForbidden, "Insufficient permissions")
			return
		}
	}

	slog.Debug("user.Handler.GetUser: request received", "id", id)
	user, err := h.service.GetUser(r.Context(), id)
	if err != nil {
		slog.Error("user.Handler.GetUser: failed", "error", err, "id", id)
		if err.Error() == "user not found" {
			helper.RespondErrorJSON(w, http.StatusNotFound, err.Error())
		} else {
			helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to get user")
		}
		return
	}
	slog.Debug("user.Handler.GetUser: success", "id", id)
	helper.RespondJSON(w, http.StatusOK, user)
}

func (h *Handler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := helper.ParseUUID(w, r, "id")
	if !ok {
		return
	}

	caller := auth.GetUserFromContext(r)
	if caller == nil {
		helper.RespondErrorJSON(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	isAdmin := caller.Role == auth.RoleAdmin
	isSelf := caller.ID == id

	if !isAdmin && !isSelf {
		helper.RespondErrorJSON(w, http.StatusForbidden, "Access denied")
		return
	}

	// Key-authed callers need the admin scope to reach other users;
	// self-updates stay scope-free (owner-bound, no cross-user effect).
	if !isSelf {
		if scopes, ok := auth.KeyScopesFromContext(r); ok && !auth.KeyCoversScope(scopes, "admin") {
			helper.RespondErrorJSON(w, http.StatusForbidden, "Insufficient permissions")
			return
		}
	}

	var req UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		helper.RespondErrorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}

	slog.Debug("user.Handler.UpdateUser: request received", "id", id)
	user, err := h.service.UpdateUser(r.Context(), id, UpdateParams{
		Email:    req.Email,
		Password: req.Password,
		Role:     req.Role,
	}, isAdmin)
	if err != nil {
		slog.Error("user.Handler.UpdateUser: failed", "error", err, "id", id)
		switch err.Error() {
		case "only administrators can change user roles":
			helper.RespondErrorJSON(w, http.StatusForbidden, err.Error())
		case "user not found":
			helper.RespondErrorJSON(w, http.StatusNotFound, err.Error())
		default:
			helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to update user")
		}
		return
	}
	slog.Info("user.Handler.UpdateUser: user updated", "id", id)
	helper.RespondJSON(w, http.StatusOK, user)
}

func (h *Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	id, ok := helper.ParseUUID(w, r, "id")
	if !ok {
		return
	}

	// Route middleware (RequireAuth) guarantees a caller here; the nil
	// check below is defense-in-depth (a missing caller would nil-deref).
	caller := auth.GetUserFromContext(r)
	if caller == nil {
		helper.RespondErrorJSON(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	slog.Debug("user.Handler.DeleteUser: request received", "id", id)
	if err := h.service.DeleteUser(r.Context(), id, caller.ID, caller.Role); err != nil {
		slog.Error("user.Handler.DeleteUser: failed", "error", err, "id", id)
		switch err.Error() {
		case "cannot delete your own account", "cannot delete demo user":
			helper.RespondErrorJSON(w, http.StatusBadRequest, err.Error())
		case "user not found":
			helper.RespondErrorJSON(w, http.StatusNotFound, err.Error())
		default:
			helper.RespondErrorJSON(w, http.StatusInternalServerError, "Failed to delete user")
		}
		return
	}
	slog.Info("user.Handler.DeleteUser: user deleted", "id", id)
	w.WriteHeader(http.StatusNoContent)
}
