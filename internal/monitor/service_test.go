package monitor

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
)

// mockQuerier answers the service queries these tests use; any other query
// panics on the nil embedded Querier.
type mockQuerier struct {
	sqlc.Querier

	createServiceFn func(ctx context.Context, arg sqlc.CreateServiceParams) (sqlc.CoregatewayService, error)
	getServiceFn    func(ctx context.Context, id uuid.UUID) (sqlc.CoregatewayService, error)
	deleteServiceFn func(ctx context.Context, id uuid.UUID) error
	listServicesFn  func(ctx context.Context) ([]sqlc.CoregatewayService, error)
}

func (m *mockQuerier) CreateService(ctx context.Context, arg sqlc.CreateServiceParams) (sqlc.CoregatewayService, error) {
	if m.createServiceFn != nil {
		return m.createServiceFn(ctx, arg)
	}
	return sqlc.CoregatewayService{}, nil
}

func (m *mockQuerier) GetService(ctx context.Context, id uuid.UUID) (sqlc.CoregatewayService, error) {
	if m.getServiceFn != nil {
		return m.getServiceFn(ctx, id)
	}
	return sqlc.CoregatewayService{}, sql.ErrNoRows
}

func (m *mockQuerier) DeleteService(ctx context.Context, id uuid.UUID) error {
	if m.deleteServiceFn != nil {
		return m.deleteServiceFn(ctx, id)
	}
	return sql.ErrNoRows
}

func (m *mockQuerier) ListServices(ctx context.Context) ([]sqlc.CoregatewayService, error) {
	if m.listServicesFn != nil {
		return m.listServicesFn(ctx)
	}
	return nil, nil
}

func TestCreateService_Success(t *testing.T) {
	mock := &mockQuerier{
		createServiceFn: func(_ context.Context, arg sqlc.CreateServiceParams) (sqlc.CoregatewayService, error) {
			return sqlc.CoregatewayService{ID: uuid.New(), Name: arg.Name, Url: arg.Url}, nil
		},
	}
	svc := NewService(mock, NewStatuses())
	result, err := svc.CreateService(context.Background(), CreateServiceRequest{Name: "My Service", URL: "https://example.com"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Name != "My Service" {
		t.Errorf("expected My Service, got %s", result.Name)
	}
}

func TestGetService_NotFound(t *testing.T) {
	svc := NewService(&mockQuerier{}, NewStatuses())
	_, err := svc.GetService(context.Background(), uuid.New())
	if err == nil || err.Error() != "service not found" {
		t.Fatalf("err = %v, want service not found", err)
	}
}

func TestDeleteService_NotFound(t *testing.T) {
	svc := NewService(&mockQuerier{}, NewStatuses())
	err := svc.DeleteService(context.Background(), uuid.New())
	if err == nil || err.Error() != "service not found" {
		t.Fatalf("err = %v, want service not found", err)
	}
}

func TestListServices_Empty(t *testing.T) {
	svc := NewService(&mockQuerier{}, NewStatuses())
	services, err := svc.ListServices(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if services == nil || len(services) != 0 {
		t.Errorf("services = %#v, want an empty list", services)
	}
}

func TestServicesCarryTheirLatestCheckFromMemory(t *testing.T) {
	checked, unchecked := uuid.New(), uuid.New()
	at := time.Date(2026, 11, 27, 9, 0, 0, 0, time.UTC)
	statuses := NewStatuses()
	statuses.Set(checked, Check{Status: "offline", ResponseTime: 42, StatusCode: 503, Error: "Unexpected status code: 503", CheckedAt: at})

	rows := map[uuid.UUID]sqlc.CoregatewayService{
		checked:   {ID: checked, Name: "a"},
		unchecked: {ID: unchecked, Name: "b"},
	}
	mock := &mockQuerier{
		listServicesFn: func(context.Context) ([]sqlc.CoregatewayService, error) {
			return []sqlc.CoregatewayService{rows[checked], rows[unchecked]}, nil
		},
		getServiceFn: func(_ context.Context, id uuid.UUID) (sqlc.CoregatewayService, error) {
			return rows[id], nil
		},
	}
	svc := NewService(mock, statuses)

	list, err := svc.ListServices(context.Background())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("listed %d services, want 2", len(list))
	}
	a, b := list[0], list[1]
	if a.CurrentStatus != "offline" || a.LastCheck == nil || !a.LastCheck.Equal(at) ||
		a.ResponseTime == nil || *a.ResponseTime != 42 || a.StatusCode == nil || *a.StatusCode != 503 ||
		a.LastError != "Unexpected status code: 503" {
		t.Errorf("checked service = %+v, want its latest check", a)
	}
	if b.CurrentStatus != "unknown" || b.LastCheck != nil || b.ResponseTime != nil {
		t.Errorf("unchecked service = %+v, want unknown with no check", b)
	}

	one, err := svc.GetService(context.Background(), checked)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if one.CurrentStatus != "offline" {
		t.Errorf("get status = %q, want offline", one.CurrentStatus)
	}
}
