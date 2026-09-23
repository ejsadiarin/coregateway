package auth

import (
	"context"
	"testing"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type mockQuerier struct {
	getUserByEmailFn      func(ctx context.Context, email string) (sqlc.CoregatewayUser, error)
	createUserFn          func(ctx context.Context, arg sqlc.CreateUserParams) (sqlc.CoregatewayUser, error)
	createSessionFn       func(ctx context.Context, arg sqlc.CreateSessionParams) (sqlc.CoregatewaySession, error)
	deleteSessionByHashFn func(ctx context.Context, tokenHash string) error
	getSessionByHashFn    func(ctx context.Context, tokenHash string) (sqlc.GetSessionByTokenHashRow, error)
	getUserFn             func(ctx context.Context, id uuid.UUID) (sqlc.CoregatewayUser, error)
}

func (m *mockQuerier) GetUserByEmail(_ context.Context, email string) (sqlc.CoregatewayUser, error) {
	if m.getUserByEmailFn != nil { return m.getUserByEmailFn(context.Background(), email) }
	return sqlc.CoregatewayUser{}, pgx.ErrNoRows
}
func (m *mockQuerier) CreateUser(ctx context.Context, arg sqlc.CreateUserParams) (sqlc.CoregatewayUser, error) {
	if m.createUserFn != nil { return m.createUserFn(ctx, arg) }
	return sqlc.CoregatewayUser{}, nil
}
func (m *mockQuerier) CreateSession(ctx context.Context, arg sqlc.CreateSessionParams) (sqlc.CoregatewaySession, error) {
	if m.createSessionFn != nil { return m.createSessionFn(ctx, arg) }
	return sqlc.CoregatewaySession{}, nil
}
func (m *mockQuerier) DeleteSessionByTokenHash(_ context.Context, tokenHash string) error {
	if m.deleteSessionByHashFn != nil { return m.deleteSessionByHashFn(context.Background(), tokenHash) }
	return nil
}
func (m *mockQuerier) GetSessionByTokenHash(_ context.Context, tokenHash string) (sqlc.GetSessionByTokenHashRow, error) {
	if m.getSessionByHashFn != nil { return m.getSessionByHashFn(context.Background(), tokenHash) }
	return sqlc.GetSessionByTokenHashRow{}, pgx.ErrNoRows
}
func (m *mockQuerier) GetUser(_ context.Context, id uuid.UUID) (sqlc.CoregatewayUser, error) {
	if m.getUserFn != nil { return m.getUserFn(context.Background(), id) }
	return sqlc.CoregatewayUser{}, pgx.ErrNoRows
}
func (m *mockQuerier) DeleteExpiredSessions(context.Context) error                { return nil }
func (m *mockQuerier) CountActiveSessions(context.Context) (int64, error)        { return 0, nil }
func (m *mockQuerier) CountAdmins(context.Context) (int64, error)                { return 0, nil }
func (m *mockQuerier) CreateApiKey(context.Context, sqlc.CreateApiKeyParams) (sqlc.CoregatewayApiKey, error) {
	return sqlc.CoregatewayApiKey{}, nil
}
func (m *mockQuerier) GetApiKeyByHash(context.Context, string) (sqlc.CoregatewayApiKey, error) {
	return sqlc.CoregatewayApiKey{}, pgx.ErrNoRows
}
func (m *mockQuerier) ListApiKeys(context.Context) ([]sqlc.ListApiKeysRow, error) {
	return nil, nil
}
func (m *mockQuerier) RevokeApiKey(context.Context, uuid.UUID) (int64, error) {
	return 0, nil
}
func (m *mockQuerier) TouchApiKeyLastUsed(context.Context, uuid.UUID) error { return nil }
func (m *mockQuerier) CreateHealthHistory(context.Context, sqlc.CreateHealthHistoryParams) (sqlc.CoregatewayServiceHealthHistory, error) {
	return sqlc.CoregatewayServiceHealthHistory{}, nil
}
func (m *mockQuerier) CreateService(context.Context, sqlc.CreateServiceParams) (sqlc.CoregatewayService, error) {
	return sqlc.CoregatewayService{}, nil
}
func (m *mockQuerier) DeleteService(context.Context, uuid.UUID) error   { return nil }
func (m *mockQuerier) DeleteSession(context.Context, uuid.UUID) error   { return nil }
func (m *mockQuerier) DeleteUser(context.Context, uuid.UUID) error      { return nil }
func (m *mockQuerier) DeleteUserSessions(context.Context, uuid.UUID) error { return nil }
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
func (m *mockQuerier) ListActiveServicesForHealthCheck(context.Context) ([]sqlc.ListActiveServicesForHealthCheckRow, error) {
	return nil, nil
}
func (m *mockQuerier) ListServices(context.Context) ([]sqlc.ListServicesRow, error) { return nil, nil }
func (m *mockQuerier) ListUsers(context.Context) ([]sqlc.CoregatewayUser, error)    { return nil, nil }
func (m *mockQuerier) UpdateService(context.Context, sqlc.UpdateServiceParams) (sqlc.CoregatewayService, error) {
	return sqlc.CoregatewayService{}, nil
}
func (m *mockQuerier) UpdateUser(context.Context, sqlc.UpdateUserParams) (sqlc.CoregatewayUser, error) {
	return sqlc.CoregatewayUser{}, nil
}

func TestRegister_Success(t *testing.T) {
	userID := uuid.New()
	mock := &mockQuerier{
		getUserByEmailFn: func(_ context.Context, _ string) (sqlc.CoregatewayUser, error) {
			return sqlc.CoregatewayUser{}, pgx.ErrNoRows
		},
		createUserFn: func(_ context.Context, arg sqlc.CreateUserParams) (sqlc.CoregatewayUser, error) {
			return sqlc.CoregatewayUser{ID: userID, Email: arg.Email, Role: arg.Role}, nil
		},
	}
	svc := NewService(mock)
	user, err := svc.Register(context.Background(), "test@example.com", "password123")
	if err != nil { t.Fatalf("unexpected error: %v", err) }
	if user.Email != "test@example.com" { t.Errorf("expected test@example.com, got %s", user.Email) }
}

func TestRegister_DuplicateEmail(t *testing.T) {
	mock := &mockQuerier{
		getUserByEmailFn: func(_ context.Context, email string) (sqlc.CoregatewayUser, error) {
			return sqlc.CoregatewayUser{Email: email}, nil
		},
	}
	svc := NewService(mock)
	_, err := svc.Register(context.Background(), "existing@example.com", "password123")
	if err == nil { t.Fatal("expected error for duplicate email") }
}

func TestLogin_InvalidCredentials(t *testing.T) {
	mock := &mockQuerier{}
	svc := NewService(mock)
	_, err := svc.Login(context.Background(), "nobody@example.com", "password")
	if err == nil { t.Fatal("expected error for invalid credentials") }
}

func TestGetUser_Found(t *testing.T) {
	userID := uuid.New()
	mock := &mockQuerier{
		getUserFn: func(_ context.Context, id uuid.UUID) (sqlc.CoregatewayUser, error) {
			return sqlc.CoregatewayUser{ID: id, Email: "found@example.com", Role: "user"}, nil
		},
	}
	svc := NewService(mock)
	user, err := svc.GetUser(context.Background(), userID)
	if err != nil { t.Fatalf("unexpected error: %v", err) }
	if user.Email != "found@example.com" { t.Errorf("expected found@example.com, got %s", user.Email) }
}

func TestLogout_Success(t *testing.T) {
	mock := &mockQuerier{
		deleteSessionByHashFn: func(_ context.Context, _ string) error { return nil },
	}
	svc := NewService(mock)
	err := svc.Logout(context.Background(), "some-token")
	if err != nil { t.Fatalf("unexpected error: %v", err) }
}
