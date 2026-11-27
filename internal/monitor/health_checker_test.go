package monitor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
)

// fakeHealthQueries answers only the service list; any other query panics
// on the nil embedded Querier, so a test fails if checks touch the database.
type fakeHealthQueries struct {
	sqlc.Querier

	mu       sync.Mutex
	services []sqlc.ListActiveServicesForHealthCheckRow
	lists    int
}

func (f *fakeHealthQueries) ListActiveServicesForHealthCheck(context.Context) ([]sqlc.ListActiveServicesForHealthCheckRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lists++
	return f.services, nil
}

func (f *fakeHealthQueries) set(services ...sqlc.ListActiveServicesForHealthCheckRow) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.services = services
}

func (f *fakeHealthQueries) listCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lists
}

func service(id uuid.UUID, url string, timeout int32) sqlc.ListActiveServicesForHealthCheckRow {
	return sqlc.ListActiveServicesForHealthCheckRow{
		ID:                  id,
		Name:                "svc",
		Url:                 url,
		HealthCheckMethod:   pgtype.Text{String: "GET", Valid: true},
		ExpectedStatusCodes: []int32{200},
		Timeout:             pgtype.Int4{Int32: timeout, Valid: true},
	}
}

func checkOnce(t *testing.T, handler http.HandlerFunc, timeout int32) Check {
	t.Helper()
	server := httptest.NewServer(handler)
	defer server.Close()

	id := uuid.New()
	statuses := NewStatuses()
	ch := NewHealthChecker(&fakeHealthQueries{}, statuses)
	ch.checkService(context.Background(), service(id, server.URL, timeout))

	got, ok := statuses.Get(id)
	if !ok {
		t.Fatal("no status kept for the checked service")
	}
	return got
}

func TestCheckKeepsTheResultInMemory(t *testing.T) {
	t.Run("expected status is online", func(t *testing.T) {
		got := checkOnce(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }, 500)
		if got.Status != "online" || got.StatusCode != 200 || got.CheckedAt.IsZero() {
			t.Fatalf("check = %+v, want online 200 with a check time", got)
		}
	})

	t.Run("unexpected status is offline with the code", func(t *testing.T) {
		got := checkOnce(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) }, 500)
		if got.Status != "offline" || !strings.Contains(got.Error, "418") {
			t.Fatalf("check = %+v, want offline naming 418", got)
		}
	})

	t.Run("timeout is offline", func(t *testing.T) {
		got := checkOnce(t, func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() }, 20)
		if got.Status != "offline" || got.Error == "" {
			t.Fatalf("check = %+v, want offline with an error", got)
		}
	})
}

// recordChecks replaces the HTTP check with a counter.
func recordChecks(ch *HealthChecker) func(uuid.UUID) int {
	var mu sync.Mutex
	counts := map[uuid.UUID]int{}
	ch.check = func(_ context.Context, svc sqlc.ListActiveServicesForHealthCheckRow) {
		mu.Lock()
		counts[svc.ID]++
		mu.Unlock()
	}
	return func(id uuid.UUID) int {
		mu.Lock()
		defer mu.Unlock()
		return counts[id]
	}
}

func TestRunChecksEveryServiceAtStartAndOnEachRound(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	queries := &fakeHealthQueries{}
	queries.set(service(a, "http://a", 500))
	ch := NewHealthChecker(queries, NewStatuses())
	count := recordChecks(ch)

	ctx, cancel := context.WithCancel(context.Background())
	ticks := make(chan time.Time)
	done := make(chan struct{})
	go func() { ch.run(ctx, ticks); close(done) }()

	waitFor(t, func() bool { return count(a) == 1 })
	if got := queries.listCalls(); got != 1 {
		t.Fatalf("service list read %d times before any round tick, want 1", got)
	}

	// A service added between rounds is picked up by the next one.
	queries.set(service(a, "http://a", 500), service(b, "http://b", 500))
	ticks <- time.Now()
	waitFor(t, func() bool { return count(a) == 2 && count(b) == 1 })
	if got := queries.listCalls(); got != 2 {
		t.Errorf("service list read %d times after one round, want 2", got)
	}

	cancel()
	<-done
}

func TestRoundForgetsServicesNoLongerActive(t *testing.T) {
	a := uuid.New()
	queries := &fakeHealthQueries{}
	queries.set(service(a, "http://a", 500))
	statuses := NewStatuses()
	ch := NewHealthChecker(queries, statuses)
	ch.check = func(_ context.Context, svc sqlc.ListActiveServicesForHealthCheckRow) {
		statuses.Set(svc.ID, Check{Status: "online", CheckedAt: time.Now()})
	}

	ch.round(context.Background())
	ch.wg.Wait()
	if _, ok := statuses.Get(a); !ok {
		t.Fatal("no status after the first round")
	}

	queries.set() // paused or deleted
	ch.round(context.Background())
	ch.wg.Wait()
	if got, ok := statuses.Get(a); ok {
		t.Errorf("status %+v kept for a service no longer active", got)
	}
}

func TestRoundBoundsConcurrencyAndNeverOverlapsOneService(t *testing.T) {
	queries := &fakeHealthQueries{}
	var services []sqlc.ListActiveServicesForHealthCheckRow
	for i := 0; i < 8; i++ {
		services = append(services, service(uuid.New(), "http://svc", 500))
	}
	queries.set(services...)
	ch := NewHealthChecker(queries, NewStatuses())

	release := make(chan struct{})
	started := make(chan struct{}, len(services))
	ch.check = func(context.Context, sqlc.ListActiveServicesForHealthCheckRow) {
		started <- struct{}{}
		<-release
	}

	ctx := context.Background()
	ch.round(ctx)
	for i := 0; i < maxConcurrentChecks; i++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatalf("only %d checks started, want %d", i, maxConcurrentChecks)
		}
	}
	select {
	case <-started:
		t.Fatal("started more checks than the concurrency cap")
	default:
	}

	// A round while the first one's checks still run must not overlap any of
	// the same services.
	ch.round(ctx)
	select {
	case <-started:
		t.Fatal("a still-running service started another check")
	default:
	}

	close(release)
	ch.wg.Wait()
}

func TestRunStopsOnCancel(t *testing.T) {
	ch := NewHealthChecker(&fakeHealthQueries{}, NewStatuses())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { ch.run(ctx, make(chan time.Time)); close(done) }()

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("run did not stop on context cancel")
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met within a second")
		}
		time.Sleep(time.Millisecond)
	}
}
