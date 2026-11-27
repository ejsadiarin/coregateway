package monitor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/ejsadiarin/coregateway/internal/services/corefinance"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

// builtinList serves one built-in corefinance service through the real
// Service, so tests observe what the services API returns.
func builtinList(t *testing.T, statuses *Statuses) func() ServiceView {
	t.Helper()
	row := sqlc.CoregatewayService{
		ID:         uuid.New(),
		Name:       "corefinance",
		IsBuiltin:  true,
		BuiltinKey: pgtype.Text{String: "corefinance", Valid: true},
	}
	svc := NewService(&mockQuerier{listServicesFn: func(context.Context) ([]sqlc.CoregatewayService, error) {
		return []sqlc.CoregatewayService{row}, nil
	}}, statuses)
	return func() ServiceView {
		t.Helper()
		list, err := svc.ListServices(context.Background())
		if err != nil || len(list) != 1 {
			t.Fatalf("list = %v, %v", list, err)
		}
		return list[0]
	}
}

func serve(h http.Handler) {
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/budget/expenses", nil))
}

func respond(code int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(code) })
}

func setupTraffic(t *testing.T) (*Statuses, *clock, func() ServiceView, uuid.UUID) {
	t.Helper()
	c := &clock{t: time.Date(2026, 11, 27, 9, 0, 0, 0, time.UTC)}
	statuses := NewStatuses()
	statuses.now = c.now
	list := builtinList(t, statuses)
	id := list().ID
	statuses.Set(id, Check{Status: "online", CheckedAt: c.t})
	return statuses, c, list, id
}

func TestFailedProxiedRequestsMarkABuiltinDegraded(t *testing.T) {
	statuses, c, list, _ := setupTraffic(t)
	h := statuses.Observe("corefinance", respond(http.StatusInternalServerError))

	serve(h)
	c.t = c.t.Add(time.Minute)
	serve(h)

	got := list()
	if got.CurrentStatus != "degraded" {
		t.Fatalf("status = %q, want degraded after proxied 5xx", got.CurrentStatus)
	}
	if got.RecentFailures != 2 || got.LastFailureAt == nil || !got.LastFailureAt.Equal(c.t) {
		t.Errorf("failures = %d last = %v, want 2 at %s", got.RecentFailures, got.LastFailureAt, c.t)
	}
}

func TestAnUnreachableDownstreamCountsAsAFailure(t *testing.T) {
	statuses, _, list, _ := setupTraffic(t)
	// Nothing listens on port 1: the real proxy answers 502.
	serve(statuses.Observe("corefinance", corefinance.New("http://127.0.0.1:1").Proxy()))

	if got := list(); got.CurrentStatus != "degraded" || got.RecentFailures != 1 {
		t.Fatalf("view = %+v, want degraded with 1 failure", got)
	}
}

func TestClientErrorsAndSuccessesDoNotCount(t *testing.T) {
	statuses, _, list, _ := setupTraffic(t)
	for _, code := range []int{http.StatusOK, http.StatusNotFound, http.StatusUnauthorized, http.StatusBadRequest} {
		serve(statuses.Observe("corefinance", respond(code)))
	}

	if got := list(); got.CurrentStatus != "online" || got.RecentFailures != 0 || got.LastFailureAt != nil {
		t.Fatalf("view = %+v, want online with no failures", got)
	}
}

func TestFailuresAgeOutAfterTenMinutesNotOnAGreenCheck(t *testing.T) {
	statuses, c, list, id := setupTraffic(t)
	serve(statuses.Observe("corefinance", respond(http.StatusBadGateway)))

	// A green health check does not clear it.
	c.t = c.t.Add(5 * time.Minute)
	statuses.Set(id, Check{Status: "online", CheckedAt: c.t})
	if got := list(); got.CurrentStatus != "degraded" {
		t.Fatalf("status = %q after a green check, want still degraded", got.CurrentStatus)
	}

	c.t = c.t.Add(5*time.Minute + time.Second)
	if got := list(); got.CurrentStatus != "online" || got.RecentFailures != 0 {
		t.Fatalf("view = %+v after 10 minutes, want online", got)
	}
}

func TestDownOutranksDegraded(t *testing.T) {
	statuses, c, list, id := setupTraffic(t)
	serve(statuses.Observe("corefinance", respond(http.StatusInternalServerError)))
	statuses.Set(id, Check{Status: "offline", Error: "Request failed", CheckedAt: c.t})

	if got := list(); got.CurrentStatus != "offline" || got.RecentFailures != 1 {
		t.Fatalf("view = %+v, want offline still showing the failure", got)
	}
}
