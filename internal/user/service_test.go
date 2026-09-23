package user

import (
	"context"
	"testing"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type mockQuerier struct {
	getUserFn        func(ctx context.Context, id uuid.UUID) (sqlc.CoregatewayUser, error)
	getByEmailFn     func(ctx context.Context, email string) (sqlc.CoregatewayUser, error)
	createUserFn     func(ctx context.Context, arg sqlc.CreateUserParams) (sqlc.CoregatewayUser, error)
	updateUserFn     func(ctx context.Context, arg sqlc.UpdateUserParams) (sqlc.CoregatewayUser, error)
	deleteUserFn     func(ctx context.Context, id uuid.UUID) error
	deleteSessionsFn func(ctx context.Context, userID uuid.UUID) error
	listUsersFn      func(ctx context.Context) ([]sqlc.CoregatewayUser, error)
}

func (m *mockQuerier) GetUser(_ context.Context, id uuid.UUID) (sqlc.CoregatewayUser, error) {
	if m.getUserFn != nil { return m.getUserFn(context.Background(), id) }
	return sqlc.CoregatewayUser{}, pgx.ErrNoRows
}
func (m *mockQuerier) GetUserByEmail(_ context.Context, email string) (sqlc.CoregatewayUser, error) {
	if m.getByEmailFn != nil { return m.getByEmailFn(context.Background(), email) }
	return sqlc.CoregatewayUser{}, pgx.ErrNoRows
}
func (m *mockQuerier) CreateUser(ctx context.Context, arg sqlc.CreateUserParams) (sqlc.CoregatewayUser, error) {
	if m.createUserFn != nil { return m.createUserFn(ctx, arg) }
	return sqlc.CoregatewayUser{}, nil
}
func (m *mockQuerier) UpdateUser(ctx context.Context, arg sqlc.UpdateUserParams) (sqlc.CoregatewayUser, error) {
	if m.updateUserFn != nil { return m.updateUserFn(ctx, arg) }
	return sqlc.CoregatewayUser{}, nil
}
func (m *mockQuerier) DeleteUser(_ context.Context, id uuid.UUID) error {
	if m.deleteUserFn != nil { return m.deleteUserFn(context.Background(), id) }
	return nil
}
func (m *mockQuerier) DeleteUserSessions(_ context.Context, userID uuid.UUID) error {
	if m.deleteSessionsFn != nil { return m.deleteSessionsFn(context.Background(), userID) }
	return nil
}
func (m *mockQuerier) ListUsers(_ context.Context) ([]sqlc.CoregatewayUser, error) {
	if m.listUsersFn != nil { return m.listUsersFn(context.Background()) }
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
func (m *mockQuerier) CreateService(context.Context, sqlc.CreateServiceParams) (sqlc.CoregatewayService, error) {
	return sqlc.CoregatewayService{}, nil
}
func (m *mockQuerier) CreateSession(context.Context, sqlc.CreateSessionParams) (sqlc.CoregatewaySession, error) {
	return sqlc.CoregatewaySession{}, nil
}
func (m *mockQuerier) DeleteExpiredSessions(context.Context) error { return nil }
func (m *mockQuerier) DeleteService(context.Context, uuid.UUID) error { return nil }
func (m *mockQuerier) DeleteSession(context.Context, uuid.UUID) error { return nil }
func (m *mockQuerier) DeleteSessionByTokenHash(context.Context, string) error { return nil }
func (m *mockQuerier) GetAllServicesStats(context.Context) (sqlc.GetAllServicesStatsRow, error) {
	return sqlc.GetAllServicesStatsRow{}, nil
}
func (m *mockQuerier) GetService(context.Context, uuid.UUID) (sqlc.CoregatewayService, error) {
	return sqlc.CoregatewayService{}, nil
}
func (m *mockQuerier) GetServiceHistory(context.Context, sqlc.GetServiceHistoryParams) ([]sqlc.CoregatewayServiceHealthHistory, error) {
	return nil, nil
}
func (m *mockQuerier) GetServiceStats24h(context.Context, pgtype.UUID) (sqlc.GetServiceStats24hRow, error) {
	return sqlc.GetServiceStats24hRow{}, nil
}
func (m *mockQuerier) GetServiceStats30d(context.Context, pgtype.UUID) (sqlc.GetServiceStats30dRow, error) {
	return sqlc.GetServiceStats30dRow{}, nil
}
func (m *mockQuerier) GetServiceStats7d(context.Context, pgtype.UUID) (sqlc.GetServiceStats7dRow, error) {
	return sqlc.GetServiceStats7dRow{}, nil
}
func (m *mockQuerier) GetSessionByTokenHash(context.Context, string) (sqlc.GetSessionByTokenHashRow, error) {
	return sqlc.GetSessionByTokenHashRow{}, nil
}
func (m *mockQuerier) ListActiveServicesForHealthCheck(context.Context) ([]sqlc.ListActiveServicesForHealthCheckRow, error) {
	return nil, nil
}
func (m *mockQuerier) ListServices(context.Context) ([]sqlc.ListServicesRow, error) { return nil, nil }
func (m *mockQuerier) UpdateService(context.Context, sqlc.UpdateServiceParams) (sqlc.CoregatewayService, error) {
	return sqlc.CoregatewayService{}, nil
}

func TestListUsers_Empty(t *testing.T) {
	mock := &mockQuerier{
		listUsersFn: func(_ context.Context) ([]sqlc.CoregatewayUser, error) {
			return []sqlc.CoregatewayUser{}, nil
		},
	}
	svc := NewService(mock)
	users, err := svc.ListUsers(context.Background())
	if err != nil { t.Fatalf("unexpected error: %v", err) }
	if len(users) != 0 { t.Errorf("expected 0 users, got %d", len(users)) }
}

func TestGetUser_Found(t *testing.T) {
	userID := uuid.New()
	mock := &mockQuerier{
		getUserFn: func(_ context.Context, id uuid.UUID) (sqlc.CoregatewayUser, error) {
			return sqlc.CoregatewayUser{ID: id, Email: "test@example.com", Role: "user"}, nil
		},
	}
	svc := NewService(mock)
	user, err := svc.GetUser(context.Background(), userID)
	if err != nil { t.Fatalf("unexpected error: %v", err) }
	if user.Email != "test@example.com" { t.Errorf("expected test@example.com, got %s", user.Email) }
}

func TestGetUser_NotFound(t *testing.T) {
	mock := &mockQuerier{}
	svc := NewService(mock)
	_, err := svc.GetUser(context.Background(), uuid.New())
	if err == nil { t.Fatal("expected error for not found") }
	if err.Error() != "user not found" { t.Errorf("expected 'user not found', got: %v", err) }
}

func TestCreateUser_DuplicateEmail(t *testing.T) {
	mock := &mockQuerier{
		getByEmailFn: func(_ context.Context, email string) (sqlc.CoregatewayUser, error) {
			return sqlc.CoregatewayUser{Email: email}, nil
		},
	}
	svc := NewService(mock)
	_, err := svc.CreateUser(context.Background(), "dup@example.com", "pass", "user")
	if err == nil { t.Fatal("expected duplicate email error") }
}

func TestDeleteUser_CannotDeleteSelf(t *testing.T) {
	mock := &mockQuerier{}
	svc := NewService(mock)
	callerID := uuid.New()
	err := svc.DeleteUser(context.Background(), callerID, callerID, "admin")
	if err == nil { t.Fatal("expected self-delete error") }
	if err.Error() != "cannot delete your own account" {
		t.Errorf("expected self-delete error, got: %v", err)
	}
}

func TestDeleteUser_CannotDeleteDemo(t *testing.T) {
	demoID := uuid.New()
	mock := &mockQuerier{
		getUserFn: func(_ context.Context, id uuid.UUID) (sqlc.CoregatewayUser, error) {
			return sqlc.CoregatewayUser{ID: id, Email: "demo@example.com"}, nil
		},
	}
	svc := NewService(mock)
	callerID := uuid.New()
	err := svc.DeleteUser(context.Background(), demoID, callerID, "admin")
	if err == nil { t.Fatal("expected demo-delete error") }
	if err.Error() != "cannot delete demo user" {
		t.Errorf("expected demo-delete error, got: %v", err)
	}
}
