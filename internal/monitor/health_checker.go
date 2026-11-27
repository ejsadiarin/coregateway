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
	// roundEvery is how often every active service is checked. Checks keep
	// their results in memory and the list is read once a round, so between
	// rounds the monitor sends nothing to the database.
	roundEvery = 5 * time.Minute
	// retryEvery rechecks services down at their last check, from the list
	// already in memory, so one that was still starting (downstreams start
	// after the gateway) shows up within seconds, not at the next round.
	retryEvery          = 30 * time.Second
	defaultTimeout      = 5 * time.Second
	maxConcurrentChecks = 4
	degradedAfter       = 5 * time.Second
)

// HealthChecker checks every active service once a round, with a cap on
// concurrent checks. A service never has two checks in flight: a round skips
// one whose previous check is still running.
type HealthChecker struct {
	queries  sqlc.Querier
	statuses *Statuses
	check    func(context.Context, sqlc.ListActiveServicesForHealthCheckRow)

	sem    chan struct{}
	wg     sync.WaitGroup
	mu     sync.Mutex
	active map[uuid.UUID]bool
	last   []sqlc.ListActiveServicesForHealthCheckRow // the latest round's list
}

func NewHealthChecker(queries sqlc.Querier, statuses *Statuses) *HealthChecker {
	ch := &HealthChecker{
		queries:  queries,
		statuses: statuses,
		sem:      make(chan struct{}, maxConcurrentChecks),
		active:   make(map[uuid.UUID]bool),
	}
	ch.check = ch.checkService
	return ch
}

// Run blocks until ctx is cancelled, running a round at start and then
// every roundEvery, and rechecking down services every retryEvery.
func (ch *HealthChecker) Run(ctx context.Context) {
	rounds := time.NewTicker(roundEvery)
	defer rounds.Stop()
	retries := time.NewTicker(retryEvery)
	defer retries.Stop()
	ch.run(ctx, rounds.C, retries.C)
}

// run is Run with injectable tick channels, so tests don't sleep.
func (ch *HealthChecker) run(ctx context.Context, rounds, retries <-chan time.Time) {
	ch.round(ctx)
	for {
		select {
		case <-ctx.Done():
			ch.wg.Wait()
			return
		case <-rounds:
			ch.round(ctx)
		case <-retries:
			ch.retry(ctx)
		}
	}
}

// round reads the active services, so added, edited and paused ones are
// picked up, and starts a check for each one not already being checked.
func (ch *HealthChecker) round(ctx context.Context) {
	services, err := ch.queries.ListActiveServicesForHealthCheck(ctx)
	if err != nil {
		slog.Error("failed to list services for health check", "error", err)
		return
	}

	ch.mu.Lock()
	ch.last = services
	ch.mu.Unlock()

	seen := make(map[uuid.UUID]bool, len(services))
	for _, service := range services {
		seen[service.ID] = true
		if ch.claim(service.ID) {
			ch.wg.Add(1)
			go ch.dispatch(ctx, service)
		}
	}
	ch.statuses.keepOnly(seen)
}

// retry rechecks the latest round's services that were down at their last
// check, without reading the database, and returns when those checks finish.
func (ch *HealthChecker) retry(ctx context.Context) {
	ch.mu.Lock()
	services := ch.last
	ch.mu.Unlock()

	var done sync.WaitGroup
	for _, service := range services {
		if check, ok := ch.statuses.Get(service.ID); !ok || check.Status != "offline" {
			continue
		}
		if !ch.claim(service.ID) {
			continue
		}
		ch.wg.Add(1)
		done.Add(1)
		go func() {
			defer done.Done()
			ch.dispatch(ctx, service)
		}()
	}
	done.Wait()
}

// claim marks a service as being checked, false if it already is.
func (ch *HealthChecker) claim(id uuid.UUID) bool {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if ch.active[id] {
		return false
	}
	ch.active[id] = true
	return true
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

func checkTimeout(timeout pgtype.Int4) time.Duration {
	if !timeout.Valid || timeout.Int32 <= 0 {
		return defaultTimeout
	}
	return time.Duration(timeout.Int32) * time.Millisecond
}

// checkService performs one health check and keeps the result.
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
		ch.save(service.ID, "offline", 0, 0, fmt.Sprintf("Failed to create request: %v", err))
		return
	}

	resp, err := client.Do(req)
	responseTime := int32(time.Since(start).Milliseconds())
	if err != nil {
		ch.save(service.ID, "offline", responseTime, 0, fmt.Sprintf("Request failed: %v", err))
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

	ch.save(service.ID, status, responseTime, int32(resp.StatusCode), errorMsg)
}

func (ch *HealthChecker) save(serviceID uuid.UUID, status string, responseTime, statusCode int32, errorMsg string) {
	ch.statuses.Set(serviceID, Check{
		Status:       status,
		ResponseTime: responseTime,
		StatusCode:   statusCode,
		Error:        errorMsg,
		CheckedAt:    time.Now(),
	})
	log := slog.Debug
	if status != "online" {
		log = slog.Warn
	}
	log("health check completed",
		"service_id", serviceID.String(),
		"status", status,
		"response_time", responseTime,
		"error", errorMsg,
	)
}
