package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/ejsadiarin/coregateway/internal/crypto"
	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	usertypes "github.com/ejsadiarin/coregateway/internal/user/v1"
	"github.com/ejsadiarin/coregateway/internal/session"
	"github.com/ejsadiarin/coregateway/internal/timezone"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Service struct {
	queries db.Querier
}

func NewService(queries db.Querier) *Service {
	return &Service{queries: queries}
}

func (s *Service) Register(ctx context.Context, email, password string) (*usertypes.User, error) {
	slog.Debug("auth.Service.Register", "email", email)
	_, err := s.queries.GetUserByEmail(ctx, email)
	if err == nil {
		return nil, fmt.Errorf("user with email %s already exists", email)
	}

	hashedPassword, err := crypto.HashPassword(password)
	if err != nil {
		slog.Error("auth.Service.Register: failed to hash password", "error", err)
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	user, err := s.queries.CreateUser(ctx, db.CreateUserParams{
		Email:        email,
		PasswordHash: pgtype.Text{String: hashedPassword, Valid: true},
		Role:         RoleUser,
	})
	if err != nil {
		slog.Error("auth.Service.Register: failed to create user", "error", err)
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	slog.Info("auth.Service.Register: user registered", "email", email)

	return &usertypes.User{
		Id:        user.ID.String(),
		Email:     user.Email,
		Role:      user.Role,
		CreatedAt: user.CreatedAt.Time.Format(time.RFC3339),
	}, nil
}

func (s *Service) Login(ctx context.Context, email, password string) (*usertypes.User, error) {
	slog.Debug("auth.Service.Login", "email", email)
	user, err := s.queries.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("invalid email or password")
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	if !user.PasswordHash.Valid {
		return nil, fmt.Errorf("invalid email or password")
	}

	valid, err := crypto.VerifyPassword(password, user.PasswordHash.String)
	if err != nil || !valid {
		return nil, fmt.Errorf("invalid email or password")
	}

	slog.Info("auth.Service.Login: user authenticated", "email", email)

	return &usertypes.User{
		Id:        user.ID.String(),
		Email:     user.Email,
		Role:      user.Role,
		CreatedAt: user.CreatedAt.Time.Format(time.RFC3339),
	}, nil
}

func (s *Service) CreateSession(ctx context.Context, userID uuid.UUID, rememberMe bool) (string, error) {
	slog.Debug("auth.Service.CreateSession", "user_id", userID)
	token, tokenHash, err := crypto.GenerateSessionToken()
	if err != nil {
		return "", fmt.Errorf("failed to generate session token: %w", err)
	}

	expiry := session.SessionExpiry
	if rememberMe {
		expiry = session.RememberMeExpiry
	}
	expiresAt := time.Now().Add(expiry)

	_, err = s.queries.CreateSession(ctx, db.CreateSessionParams{
		UserID:    userID,
		TokenHash: tokenHash,
		ExpiresAt: pgtype.Timestamp{Time: expiresAt, Valid: true},
	})
	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}

	return token, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	slog.Debug("auth.Service.Logout")
	tokenHash := crypto.HashSessionToken(token)
	return s.queries.DeleteSessionByTokenHash(ctx, tokenHash)
}

func (s *Service) GetSessionUser(ctx context.Context, token string) (*usertypes.User, error) {
	slog.Debug("auth.Service.GetSessionUser")
	tokenHash := crypto.HashSessionToken(token)
	session, err := s.queries.GetSessionByTokenHash(ctx, tokenHash)
	if err != nil {
		return nil, fmt.Errorf("invalid or expired session: %w", err)
	}

	user, err := s.queries.GetUser(ctx, session.UserID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &usertypes.User{
		Id:        user.ID.String(),
		Email:     user.Email,
		Role:      user.Role,
		CreatedAt: user.CreatedAt.Time.Format(time.RFC3339),
	}, nil
}

// UserRecord is what the gateway needs to know about a user to mint their
// internal token: their role and their timezone (an IANA zone, already
// defaulted to UTC when unset).
type UserRecord struct {
	Role     string
	Timezone string
}

// LookupUser reports a user's record. A missing user is pgx.ErrNoRows,
// wrapped.
func (s *Service) LookupUser(ctx context.Context, id uuid.UUID) (UserRecord, error) {
	user, err := s.queries.GetUser(ctx, id)
	if err != nil {
		return UserRecord{}, fmt.Errorf("failed to look up user: %w", err)
	}
	return UserRecord{Role: user.Role, Timezone: timezone.Effective(user.Timezone)}, nil
}

func (s *Service) GetUser(ctx context.Context, id uuid.UUID) (*usertypes.User, error) {
	slog.Debug("auth.Service.GetUser", "id", id)
	user, err := s.queries.GetUser(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &usertypes.User{
		Id:        user.ID.String(),
		Email:     user.Email,
		Role:      user.Role,
		CreatedAt: user.CreatedAt.Time.Format(time.RFC3339),
	}, nil
}

func (s *Service) LoginAsDemo(ctx context.Context) (*usertypes.User, string, error) {
	slog.Debug("auth.Service.LoginAsDemo")
	user, err := s.queries.GetUserByEmail(ctx, DemoUserEmail)
	if err != nil {
		return nil, "", fmt.Errorf("demo user not available: %w", err)
	}

	token, err := s.CreateSession(ctx, user.ID, false)
	if err != nil {
		return nil, "", err
	}

	slog.Info("auth.Service.LoginAsDemo: demo user logged in")

	return &usertypes.User{
		Id:        user.ID.String(),
		Email:     user.Email,
		Role:      user.Role,
		CreatedAt: user.CreatedAt.Time.Format(time.RFC3339),
	}, token, nil
}
