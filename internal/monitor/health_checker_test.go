package monitor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
)

type fakeHealthQueries struct {
	sqlc.Querier

	services []sqlc.ListActiveServicesForHealthCheckRow
	created  []sqlc.CreateHealthHistoryParams
	cutoff   pgtype.Timestamp
	prunes   int
}

func (f *fakeHealthQueries) ListActiveServicesForHealthCheck(context.Context) ([]sqlc.ListActiveServicesForHealthCheckRow, error) {
	return f.services, nil
}

func (f *fakeHealthQueries) CreateHealthHistory(_ context.Context, arg sqlc.CreateHealthHistoryParams) (sqlc.CoregatewayServiceHealthHistory, error) {
	f.created = append(f.created, arg)
	return sqlc.CoregatewayServiceHealthHistory{}, nil
}

func (f *fakeHealthQueries) DeleteOldHealthHistory(_ context.Context, cutoff pgtype.Timestamp) (int64, error) {
	f.prunes++
	f.cutoff = cutoff
	return 1, nil
}

func service(id uuid.UUID, url string, interval, timeout int32) sqlc.ListActiveServicesForHealthCheckRow {
	return sqlc.ListActiveServicesForHealthCheckRow{
		ID:                  id,
		Name:                "svc",
		Url:                 url,
		HealthCheckMethod:   pgtype.Text{String: "GET", Valid: true},
		ExpectedStatusCodes: []int32{200},
		Timeout:             pgtype.Int4{Int32: timeout, Valid: true},
		HealthCheckInterval: pgtype.Int4{Int32: interval, Valid: true},
	}
}

func TestCheckServiceUsesExpectedStatusAndTimeout(t *testing.T) {
	t.Run("expected status records online", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		queries := &fakeHealthQueries{}
		ch := NewHealthChecker(queries)
		ch.checkService(context.Background(), service(uuid.New(), server.URL, 60, 500))

		if len(queries.created) != 1 || queries.created[0].Status != "online" {
			t.Fatalf("created = %+v, want one online check", queries.created)
		}
	})

	t.Run("unexpected status records offline", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		}))
		defer server.Close()

		queries := &fakeHealthQueries{}
		ch := NewHealthChecker(queries)
		ch.checkService(context.Background(), service(uuid.New(), server.URL, 60, 500))

		if len(queries.created) != 1 || queries.created[0].Status != "offline" {
			t.Fatalf("created = %+v, want one offline check", queries.created)
		}
		if !strings.Contains(queries.created[0].ErrorMessage.String, "418") {
			t.Errorf("error = %q, want the status code", queries.created[0].ErrorMessage.String)
		}
	})

	t.Run("timeout records offline", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			<-r.Context().Done()
		}))
		defer server.Close()

		queries := &fakeHealthQueries{}
		ch := NewHealthChecker(queries)
		ch.checkService(context.Background(), service(uuid.New(), server.URL, 60, 20))

		if len(queries.created) != 1 || queries.created[0].Status != "offline" {
			t.Fatalf("created = %+v, want one offline check", queries.created)
		}
	})
}

func TestCheckDueUsesEachServicesInterval(t *testing.T) {
	serviceA, serviceB := uuid.New(), uuid.New()
	queries := &fakeHealthQueries{services: []sqlc.ListActiveServicesForHealthCheckRow{
		service(serviceA, "http://a", 30, 500),
		service(serviceB, "http://b", 60, 500),
	}}
	ch := NewHealthChecker(queries)
	var checked sync.Map
	ch.check = func(_ context.Context, svc sqlc.ListActiveServicesForHealthCheckRow) {
		count, _ := checked.LoadOrStore(svc.ID, new(atomic.Int32))
		count.(*atomic.Int32).Add(1)
	}

	now := time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC)
	ch.checkDue(context.Background(), now)
	ch.wg.Wait()
	if got := countOf(&checked, serviceA); got != 1 {
		t.Fatalf("A after start = %d, want 1", got)
	}

	ch.checkDue(context.Background(), now.Add(30*time.Second))
	ch.wg.Wait()
	if got := countOf(&checked, serviceA); got != 2 {
		t.Errorf("A after 30s = %d, want 2", got)
	}
	if got := countOf(&checked, serviceB); got != 1 {
		t.Errorf("B after 30s = %d, want 1", got)
	}

	ch.checkDue(context.Background(), now.Add(60*time.Second))
	ch.wg.Wait()
	if got := countOf(&checked, serviceB); got != 2 {
		t.Errorf("B after 60s = %d, want 2", got)
	}
}

func countOf(checked *sync.Map, id uuid.UUID) int32 {
	value, ok := checked.Load(id)
	if !ok {
		return 0
	}
	return value.(*atomic.Int32).Load()
}

func TestCheckDueBoundsConcurrencyAndNeverOverlapsOneService(t *testing.T) {
	var services []sqlc.ListActiveServicesForHealthCheckRow
	for i := 0; i < 8; i++ {
		services = append(services, service(uuid.New(), "http://svc", 1, 500))
	}
	queries := &fakeHealthQueries{services: services}
	ch := NewHealthChecker(queries)

	release := make(chan struct{})
	started := make(chan struct{}, len(services))
	ch.check = func(context.Context, sqlc.ListActiveServicesForHealthCheckRow) {
		started <- struct{}{}
		<-release
	}

	ctx := context.Background()
	ch.checkDue(ctx, time.Now())
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

	// A second due tick while the first checks run must not overlap any of
	// the same services.
	ch.checkDue(ctx, time.Now().Add(2*time.Second))
	select {
	case <-started:
		t.Fatal("a still-running service started another check")
	default:
	}

	close(release)
	ch.wg.Wait()
}

func TestPruneKeepsThirtyDaysAndRunsDaily(t *testing.T) {
	queries := &fakeHealthQueries{}
	ch := NewHealthChecker(queries)
	now := time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC)

	ch.prune(context.Background(), now)
	if queries.prunes != 1 {
		t.Fatalf("prunes = %d, want 1", queries.prunes)
	}
	if want := now.Add(-30 * 24 * time.Hour); !queries.cutoff.Time.Equal(want) {
		t.Errorf("cutoff = %s, want %s", queries.cutoff.Time, want)
	}

	ch.prune(context.Background(), now.Add(time.Hour))
	if queries.prunes != 1 {
		t.Errorf("prunes within a day = %d, want 1", queries.prunes)
	}
	ch.prune(context.Background(), now.Add(24*time.Hour))
	if queries.prunes != 2 {
		t.Errorf("prunes after a day = %d, want 2", queries.prunes)
	}
}

func TestRunStopsOnCancel(t *testing.T) {
	queries := &fakeHealthQueries{}
	ch := NewHealthChecker(queries)
	ctx, cancel := context.WithCancel(context.Background())
	ticks := make(chan time.Time)
	done := make(chan struct{})

	go func() {
		ch.run(ctx, ticks)
		close(done)
	}()

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("run did not stop on context cancel")
	}
}
