package monitor

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
)

const (
	defaultCheckInterval = time.Minute
	defaultTimeout       = 5 * time.Second
	maxConcurrentChecks  = 4
	schedulerTick        = time.Second
	healthRetention      = 30 * 24 * time.Hour
	pruneEvery           = 24 * time.Hour
	degradedAfter        = 5 * time.Second
)

// HealthChecker runs each active service on its own interval, with a cap on
// concurrent checks. A service never has two checks in flight: its next slot
// waits for the running one to finish.
type HealthChecker struct {
	queries sqlc.Querier
	now     func() time.Time
	check   func(context.Context, sqlc.ListActiveServicesForHealthCheckRow)

	sem    chan struct{}
	wg     sync.WaitGroup
	mu     sync.Mutex
	active map[uuid.UUID]bool
	next   map[uuid.UUID]time.Time

	lastPrune time.Time
}

func NewHealthChecker(queries sqlc.Querier) *HealthChecker {
	ch := &HealthChecker{
		queries: queries,
		now:     time.Now,
		sem:     make(chan struct{}, maxConcurrentChecks),
		active:  make(map[uuid.UUID]bool),
		next:    make(map[uuid.UUID]time.Time),
	}
	ch.check = ch.checkService
	return ch
}

// Run blocks until ctx is cancelled, checking services as their own
// intervals fall due and pruning history once a day.
func (ch *HealthChecker) Run(ctx context.Context) {
	ticker := time.NewTicker(schedulerTick)
	defer ticker.Stop()
	ch.run(ctx, ticker.C)
}

// run is Run with an injectable tick channel, so tests don't sleep.
func (ch *HealthChecker) run(ctx context.Context, ticks <-chan time.Time) {
	now := ch.now()
	ch.prune(ctx, now)
	ch.checkDue(ctx, now)

	for {
		select {
		case <-ctx.Done():
			ch.wg.Wait()
			return
		case now := <-ticks:
			ch.prune(ctx, now)
			ch.checkDue(ctx, now)
		}
	}
}

// checkDue starts a check for every active service whose own interval has
// elapsed. A service with a check still running is skipped.
func (ch *HealthChecker) checkDue(ctx context.Context, now time.Time) {
	services, err := ch.queries.ListActiveServicesForHealthCheck(ctx)
	if err != nil {
		slog.Error("failed to list services for health check", "error", err)
		return
	}

	seen := make(map[uuid.UUID]bool, len(services))
	for _, service := range services {
		seen[service.ID] = true

		ch.mu.Lock()
		due, scheduled := ch.next[service.ID]
		running := ch.active[service.ID]
		if !scheduled {
			due = now
		}
		if running || now.Before(due) {
			ch.mu.Unlock()
			continue
		}
		ch.next[service.ID] = now.Add(checkInterval(service.HealthCheckInterval))
		ch.active[service.ID] = true
		ch.mu.Unlock()

		ch.wg.Add(1)
		go ch.dispatch(ctx, service)
	}

	// A service that was deleted or paused no longer needs a slot.
	ch.mu.Lock()
	for id := range ch.next {
		if !seen[id] && !ch.active[id] {
			delete(ch.next, id)
		}
	}
	ch.mu.Unlock()
}

func (ch *HealthChecker) dispatch(ctx context.Context, service sqlc.ListActiveServicesForHealthCheckRow) {
	defer ch.wg.Done()
	defer func() {
		ch.mu.Lock()
		delete(ch.active, service.ID)
		ch.mu.Unlock()
	}()

	select {
	case ch.sem <- struct{}{}:
		defer func() { <-ch.sem }()
		ch.check(ctx, service)
	case <-ctx.Done():
	}
}

func checkInterval(interval pgtype.Int4) time.Duration {
	if !interval.Valid || interval.Int32 <= 0 {
		return defaultCheckInterval
	}
	return time.Duration(interval.Int32) * time.Second
}

func checkTimeout(timeout pgtype.Int4) time.Duration {
	if !timeout.Valid || timeout.Int32 <= 0 {
		return defaultTimeout
	}
	return time.Duration(timeout.Int32) * time.Millisecond
}

// checkService performs one health check and records the result.
func (ch *HealthChecker) checkService(ctx context.Context, service sqlc.ListActiveServicesForHealthCheckRow) {
	start := time.Now()

	method := "GET"
	if service.HealthCheckMethod.Valid && service.HealthCheckMethod.String != "" {
		method = service.HealthCheckMethod.String
	}
	timeout := checkTimeout(service.Timeout)

	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequestWithContext(ctx, method, service.Url, nil)
	if err != nil {
		ch.save(ctx, service.ID, "offline", 0, 0, fmt.Sprintf("Failed to create request: %v", err))
		return
	}

	resp, err := client.Do(req)
	responseTime := int32(time.Since(start).Milliseconds())
	if err != nil {
		ch.save(ctx, service.ID, "offline", responseTime, 0, fmt.Sprintf("Request failed: %v", err))
		return
	}
	defer resp.Body.Close()

	expected := false
	for _, code := range service.ExpectedStatusCodes {
		if int32(resp.StatusCode) == code {
			expected = true
			break
		}
	}

	status := "online"
	errorMsg := ""
	if !expected {
		status = "offline"
		errorMsg = fmt.Sprintf("Unexpected status code: %d", resp.StatusCode)
	} else if responseTime > int32(degradedAfter.Milliseconds()) {
		status = "degraded"
	}

	ch.save(ctx, service.ID, status, responseTime, int32(resp.StatusCode), errorMsg)
}

func (ch *HealthChecker) save(ctx context.Context, serviceID uuid.UUID, status string, responseTime, statusCode int32, errorMsg string) {
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

	if _, err := ch.queries.CreateHealthHistory(ctx, params); err != nil {
		slog.Error("failed to save health check", "error", err, "service_id", serviceID)
		return
	}

	slog.Info("health check completed",
		"service_id", serviceID.String(),
		"status", status,
		"response_time", responseTime,
	)
}

// prune deletes history older than the retention window, at most once a day.
// An explicit call with a fresh lastPrune is a no-op; the delete itself is
// idempotent.
func (ch *HealthChecker) prune(ctx context.Context, now time.Time) {
	if !ch.lastPrune.IsZero() && now.Sub(ch.lastPrune) < pruneEvery {
		return
	}
	cutoff := pgtype.Timestamp{Time: now.Add(-healthRetention), Valid: true}
	deleted, err := ch.queries.DeleteOldHealthHistory(ctx, cutoff)
	if err != nil {
		slog.Error("failed to prune health history", "error", err)
		return
	}
	ch.lastPrune = now
	slog.Info("pruned health history", "deleted", deleted, "before", cutoff.Time)
}
