package monitor

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ServiceView is a monitored service with its latest health check, which the
// checker keeps in memory. A service not yet checked is "unknown".
type ServiceView struct {
	sqlc.CoregatewayService
	CurrentStatus string     `json:"current_status"`
	LastCheck     *time.Time `json:"last_check,omitempty"`
	ResponseTime  *int32     `json:"response_time,omitempty"`
	StatusCode    *int32     `json:"status_code,omitempty"`
	LastError     string     `json:"last_error,omitempty"`
	// Built-ins only: proxied requests the downstream failed in the last
	// 10 minutes. Any make an otherwise healthy service "degraded".
	RecentFailures int        `json:"recent_failures,omitempty"`
	LastFailureAt  *time.Time `json:"last_failure_at,omitempty"`
}

type Service struct {
	queries  sqlc.Querier
	statuses *Statuses
}

func NewService(queries sqlc.Querier, statuses *Statuses) *Service {
	return &Service{queries: queries, statuses: statuses}
}

func (s *Service) view(service sqlc.CoregatewayService) ServiceView {
	v := ServiceView{CoregatewayService: service, CurrentStatus: "unknown"}
	if check, ok := s.statuses.Get(service.ID); ok {
		v.CurrentStatus = check.Status
		v.LastCheck = &check.CheckedAt
		v.ResponseTime = &check.ResponseTime
		if check.StatusCode != 0 {
			v.StatusCode = &check.StatusCode
		}
		v.LastError = check.Error
	}

	if service.IsBuiltin && service.BuiltinKey.Valid {
		if n, last := s.statuses.recentFailures(service.BuiltinKey.String); n > 0 {
			v.RecentFailures = n
			v.LastFailureAt = &last
			// Down (a failed health check) outranks degraded.
			if v.CurrentStatus != "offline" {
				v.CurrentStatus = "degraded"
			}
		}
	}
	return v
}

func (s *Service) CreateService(ctx context.Context, req CreateServiceRequest) (*sqlc.CoregatewayService, error) {
	slog.Debug("monitor.Service.CreateService", "name", req.Name, "url", req.URL)
	healthCheckMethod := "GET"
	if req.HealthCheckMethod != nil {
		healthCheckMethod = *req.HealthCheckMethod
	}

	timeout := int32(5000)
	if req.Timeout != nil {
		timeout = *req.Timeout
	}

	expectedStatusCodes := []int32{200, 204}
	if len(req.ExpectedStatusCodes) > 0 {
		expectedStatusCodes = req.ExpectedStatusCodes
	}

	var icon, description, serviceType pgtype.Text
	if req.Icon != nil {
		icon = pgtype.Text{String: *req.Icon, Valid: true}
	}
	if req.Description != nil {
		description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.ServiceType != nil {
		serviceType = pgtype.Text{String: *req.ServiceType, Valid: true}
	}

	service, err := s.queries.CreateService(ctx, sqlc.CreateServiceParams{
		Name:                req.Name,
		Url:                 req.URL,
		Icon:                icon,
		Description:         description,
		ServiceType:         serviceType,
		HealthCheckMethod:   pgtype.Text{String: healthCheckMethod, Valid: true},
		ExpectedStatusCodes: expectedStatusCodes,
		Timeout:             pgtype.Int4{Int32: timeout, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create service: %w", err)
	}

	return &service, nil
}

func (s *Service) ListServices(ctx context.Context) ([]ServiceView, error) {
	slog.Debug("monitor.Service.ListServices")
	services, err := s.queries.ListServices(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list services: %w", err)
	}

	views := make([]ServiceView, len(services))
	for i, service := range services {
		views[i] = s.view(service)
	}
	return views, nil
}

func (s *Service) GetService(ctx context.Context, id uuid.UUID) (*ServiceView, error) {
	slog.Debug("monitor.Service.GetService", "id", id)
	service, err := s.queries.GetService(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("service not found")
		}
		return nil, fmt.Errorf("failed to get service: %w", err)
	}

	v := s.view(service)
	return &v, nil
}

func (s *Service) UpdateService(ctx context.Context, id uuid.UUID, req UpdateServiceRequest) (*sqlc.CoregatewayService, error) {
	slog.Debug("monitor.Service.UpdateService", "id", id)
	current, err := s.queries.GetService(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("service not found")
		}
		return nil, fmt.Errorf("failed to get service: %w", err)
	}
	if current.IsBuiltin && req.URL != nil && *req.URL != current.Url {
		return nil, ErrBuiltinURL
	}

	params := sqlc.UpdateServiceParams{ID: id}

	if req.Name != nil {
		params.Name = pgtype.Text{String: *req.Name, Valid: true}
	}
	if req.URL != nil {
		params.Url = pgtype.Text{String: *req.URL, Valid: true}
	}
	if req.Icon != nil {
		params.Icon = pgtype.Text{String: *req.Icon, Valid: true}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.ServiceType != nil {
		params.ServiceType = pgtype.Text{String: *req.ServiceType, Valid: true}
	}
	if req.HealthCheckMethod != nil {
		params.HealthCheckMethod = pgtype.Text{String: *req.HealthCheckMethod, Valid: true}
	}
	if req.ExpectedStatusCodes != nil {
		params.ExpectedStatusCodes = req.ExpectedStatusCodes
	}
	if req.Timeout != nil {
		params.Timeout = pgtype.Int4{Int32: *req.Timeout, Valid: true}
	}
	if req.IsActive != nil {
		params.IsActive = pgtype.Bool{Bool: *req.IsActive, Valid: true}
	}

	service, err := s.queries.UpdateService(ctx, params)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("service not found")
		}
		return nil, fmt.Errorf("failed to update service: %w", err)
	}

	return &service, nil
}

func (s *Service) DeleteService(ctx context.Context, id uuid.UUID) error {
	slog.Debug("monitor.Service.DeleteService", "id", id)
	current, err := s.queries.GetService(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("service not found")
		}
		return fmt.Errorf("failed to get service: %w", err)
	}
	if current.IsBuiltin {
		return ErrBuiltinService
	}

	if err := s.queries.DeleteService(ctx, id); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("service not found")
		}
		return fmt.Errorf("failed to delete service: %w", err)
	}

	return nil
}
