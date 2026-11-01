package monitor

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type HealthChecker struct {
	queries sqlc.Querier
}

func NewHealthChecker(queries sqlc.Querier) *HealthChecker {
	return &HealthChecker{
		queries: queries,
	}
}

// CheckService performs a health check on a single service
func (ch *HealthChecker) CheckService(service sqlc.ListActiveServicesForHealthCheckRow) {
	start := time.Now()

	// extract health check method
	method := "GET"
	if service.HealthCheckMethod.Valid {
		method = service.HealthCheckMethod.String
	}

	// extract timeout
	timeout := 5000
	if service.Timeout.Valid {
		timeout = int(service.Timeout.Int32)
	}

	client := &http.Client{
		Timeout: time.Duration(timeout) * time.Millisecond,
	}

	req, err := http.NewRequest(method, service.Url, nil)
	if err != nil {
		ch.saveHealthCheck(service.ID, "offline", 0, 0, fmt.Sprintf("Failed to create request: %v", err))
		return
	}

	resp, err := client.Do(req)
	responseTime := int32(time.Since(start).Milliseconds())

	if err != nil {
		ch.saveHealthCheck(service.ID, "offline", responseTime, 0, fmt.Sprintf("Request failed: %v", err))
		return
	}
	defer resp.Body.Close()

	// check if status code is expected
	statusOK := false
	for _, code := range service.ExpectedStatusCodes {
		if int32(resp.StatusCode) == code {
			statusOK = true
			break
		}
	}

	status := "online"
	errorMsg := ""
	if !statusOK {
		status = "offline"
		errorMsg = fmt.Sprintf("Unexpected status code: %d", resp.StatusCode)
	} else if responseTime > 5000 {
		status = "degraded"
	}

	ch.saveHealthCheck(service.ID, status, responseTime, int32(resp.StatusCode), errorMsg)
}

// saveHealthCheck saves a health check result to the database
func (ch *HealthChecker) saveHealthCheck(serviceID uuid.UUID, status string, responseTime int32, statusCode int32, errorMsg string) {
	params := sqlc.CreateHealthHistoryParams{
		ServiceID: pgtype.UUID{Bytes: serviceID, Valid: true},
		Status:    status,
	}

	if responseTime > 0 {
		params.ResponseTime = pgtype.Int4{Int32: responseTime, Valid: true}
	}

	if statusCode > 0 {
		params.StatusCode = pgtype.Int4{Int32: statusCode, Valid: true}
	}

	if errorMsg != "" {
		params.ErrorMessage = pgtype.Text{String: errorMsg, Valid: true}
	}

	_, err := ch.queries.CreateHealthHistory(context.Background(), params)
	if err != nil {
		slog.Error("Failed to save health check", "error", err)
		return
	}

	slog.Info("Health check completed",
		"service_id", serviceID.String(),
		"status", status,
		"response_time", responseTime,
	)
}

// CheckAllServices performs health checks on all active services
func (ch *HealthChecker) CheckAllServices() {
	services, err := ch.queries.ListActiveServicesForHealthCheck(context.Background())
	if err != nil {
		slog.Error("Failed to fetch services for health check", "error", err)
		return
	}

	slog.Info("Starting health checks", "count", len(services))

	// perform health checks concurrently
	for _, service := range services {
		go ch.CheckService(service)
	}
}

// StartHealthCheckScheduler starts the background health check scheduler
func (ch *HealthChecker) StartHealthCheckScheduler(interval time.Duration) {
	// initial check
	go ch.CheckAllServices()

	// schedule checks
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			ch.CheckAllServices()
		}
	}()

	slog.Info("Health check scheduler started", "interval", interval)
}
