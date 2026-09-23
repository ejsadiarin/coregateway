package service

import (
	"context"
	"database/sql"
	"testing"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type mockQuerier struct {
	createServiceFn func(ctx context.Context, arg sqlc.CreateServiceParams) (sqlc.CoregatewayService, error)
	getServiceFn    func(ctx context.Context, id uuid.UUID) (sqlc.CoregatewayService, error)
	deleteServiceFn func(ctx context.Context, id uuid.UUID) error
	listServicesFn  func(ctx context.Context) ([]sqlc.ListServicesRow, error)
}

func (m *mockQuerier) CreateService(ctx context.Context, arg sqlc.CreateServiceParams) (sqlc.CoregatewayService, error) {
	if m.createServiceFn != nil { return m.createServiceFn(ctx, arg) }
	return sqlc.CoregatewayService{}, nil
}
func (m *mockQuerier) GetService(_ context.Context, id uuid.UUID) (sqlc.CoregatewayService, error) {
	if m.getServiceFn != nil { return m.getServiceFn(context.Background(), id) }
	return sqlc.CoregatewayService{}, sql.ErrNoRows
}
func (m *mockQuerier) DeleteService(_ context.Context, id uuid.UUID) error {
	if m.deleteServiceFn != nil { return m.deleteServiceFn(context.Background(), id) }
	return sql.ErrNoRows
}
func (m *mockQuerier) ListServices(_ context.Context) ([]sqlc.ListServicesRow, error) {
	if m.listServicesFn != nil { return m.listServicesFn(context.Background()) }
	return nil, nil
}

func (m *mockQuerier) CountActiveSessions(context.Context) (int64, error) { return 0, nil }
func (m *mockQuerier) CountAdmins(context.Context) (int64, error) { return 0, nil }
func (m *mockQuerier) CreateApiKey(context.Context, sqlc.CreateApiKeyParams) (sqlc.CoregatewayApiKey, error) {
	return sqlc.CoregatewayApiKey{}, nil
}
func (m *mockQuerier) GetApiKeyByHash(context.Context, string) (sqlc.CoregatewayApiKey, error) {
	return sqlc.CoregatewayApiKey{}, nil
}
func (m *mockQuerier) ListApiKeys(context.Context) ([]sqlc.ListApiKeysRow, error) {
	return nil, nil
}
func (m *mockQuerier) RevokeApiKey(context.Context, uuid.UUID) (int64, error) { return 0, nil }
func (m *mockQuerier) TouchApiKeyLastUsed(context.Context, uuid.UUID) error  { return nil }
func (m *mockQuerier) CreateHealthHistory(context.Context, sqlc.CreateHealthHistoryParams) (sqlc.CoregatewayServiceHealthHistory, error) {
	return sqlc.CoregatewayServiceHealthHistory{}, nil
}
func (m *mockQuerier) CreateSession(context.Context, sqlc.CreateSessionParams) (sqlc.CoregatewaySession, error) {
	return sqlc.CoregatewaySession{}, nil
}
func (m *mockQuerier) CreateUser(context.Context, sqlc.CreateUserParams) (sqlc.CoregatewayUser, error) {
	return sqlc.CoregatewayUser{}, nil
}
func (m *mockQuerier) DeleteExpiredSessions(context.Context) error { return nil }
func (m *mockQuerier) DeleteSession(context.Context, uuid.UUID) error { return nil }
func (m *mockQuerier) DeleteSessionByTokenHash(context.Context, string) error { return nil }
func (m *mockQuerier) DeleteUser(context.Context, uuid.UUID) error { return nil }
func (m *mockQuerier) DeleteUserSessions(context.Context, uuid.UUID) error { return nil }
func (m *mockQuerier) GetAllServicesStats(context.Context) (sqlc.GetAllServicesStatsRow, error) {
	return sqlc.GetAllServicesStatsRow{}, nil
}
func (m *mockQuerier) GetServiceHistory(context.Context, sqlc.GetServiceHistoryParams) ([]sqlc.CoregatewayServiceHealthHistory, error) {
	return nil, nil
}
func (m *mockQuerier) GetServiceStats24h(context.Context, pgtype.UUID) (sqlc.GetServiceStats24hRow, error) {
	return sqlc.GetServiceStats24hRow{}, nil
}
func (m *mockQuerier) GetServiceStats7d(context.Context, pgtype.UUID) (sqlc.GetServiceStats7dRow, error) {
	return sqlc.GetServiceStats7dRow{}, nil
}
func (m *mockQuerier) GetServiceStats30d(context.Context, pgtype.UUID) (sqlc.GetServiceStats30dRow, error) {
	return sqlc.GetServiceStats30dRow{}, nil
}
func (m *mockQuerier) GetSessionByTokenHash(context.Context, string) (sqlc.GetSessionByTokenHashRow, error) {
	return sqlc.GetSessionByTokenHashRow{}, nil
}
func (m *mockQuerier) GetUser(context.Context, uuid.UUID) (sqlc.CoregatewayUser, error) {
	return sqlc.CoregatewayUser{}, nil
}
func (m *mockQuerier) GetUserByEmail(context.Context, string) (sqlc.CoregatewayUser, error) {
	return sqlc.CoregatewayUser{}, nil
}
func (m *mockQuerier) ListActiveServicesForHealthCheck(context.Context) ([]sqlc.ListActiveServicesForHealthCheckRow, error) {
	return nil, nil
}
func (m *mockQuerier) ListUsers(context.Context) ([]sqlc.CoregatewayUser, error) { return nil, nil }
func (m *mockQuerier) UpdateService(context.Context, sqlc.UpdateServiceParams) (sqlc.CoregatewayService, error) {
	return sqlc.CoregatewayService{}, nil
}
func (m *mockQuerier) UpdateUser(context.Context, sqlc.UpdateUserParams) (sqlc.CoregatewayUser, error) {
	return sqlc.CoregatewayUser{}, nil
}

func TestCreateService_Success(t *testing.T) {
	mock := &mockQuerier{
		createServiceFn: func(_ context.Context, arg sqlc.CreateServiceParams) (sqlc.CoregatewayService, error) {
			return sqlc.CoregatewayService{ID: uuid.New(), Name: arg.Name, Url: arg.Url}, nil
		},
	}
	svc := NewService(mock)
	result, err := svc.CreateService(context.Background(), CreateServiceRequest{Name: "My Service", URL: "https://example.com"})
	if err != nil { t.Fatalf("unexpected error: %v", err) }
	if result.Name != "My Service" { t.Errorf("expected My Service, got %s", result.Name) }
}

func TestGetService_NotFound(t *testing.T) {
	mock := &mockQuerier{}
	svc := NewService(mock)
	_, err := svc.GetService(context.Background(), uuid.New())
	if err == nil { t.Fatal("expected error for service not found") }
	if err.Error() != "service not found" { t.Errorf("expected 'service not found', got: %v", err) }
}

func TestDeleteService_NotFound(t *testing.T) {
	mock := &mockQuerier{}
	svc := NewService(mock)
	err := svc.DeleteService(context.Background(), uuid.New())
	if err == nil { t.Fatal("expected error for service not found") }
	if err.Error() != "service not found" { t.Errorf("expected 'service not found', got: %v", err) }
}

func TestListServices_Empty(t *testing.T) {
	mock := &mockQuerier{
		listServicesFn: func(_ context.Context) ([]sqlc.ListServicesRow, error) {
			return []sqlc.ListServicesRow{}, nil
		},
	}
	svc := NewService(mock)
	services, err := svc.ListServices(context.Background())
	if err != nil { t.Fatalf("unexpected error: %v", err) }
	if len(services) != 0 { t.Errorf("expected 0 services, got %d", len(services)) }
}
