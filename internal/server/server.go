package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/config"
	monitor "github.com/ejsadiarin/coregateway/internal/monitor"
	"github.com/ejsadiarin/coregateway/internal/services/corefinance"
	"github.com/ejsadiarin/coregateway/internal/token"
	"github.com/ejsadiarin/coregateway/internal/user"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
)

type Server struct {
	port              int
	AuthHandler       *auth.Handler
	KeysHandler       *auth.KeysHandler
	KeysService       *auth.KeysService
	UserHandler       *user.Handler
	ServiceHandler    *monitor.Handler
	AuthService       *auth.Service
	CorefinanceClient *corefinance.Client
	TokenIssuer       *token.Issuer
	Queries           *db.Queries
	Pool              *pgxpool.Pool
}

// New builds the server. It fails closed when internal JWT identity cannot
// be established: without key material the gateway refuses to start rather
// than run unable to create tokens.
func New(cfg *config.Config, pool *pgxpool.Pool, queries *db.Queries) (*http.Server, error) {
	issuer, err := token.NewIssuerFromPEM(
		cfg.JWTPrivateKeyPEM,
		cfg.JWTKID,
		cfg.JWTPrevPrivateKeyPEM,
		cfg.JWTPrevKID,
		cfg.JWTIssuer,
		cfg.JWTAudience,
		time.Duration(cfg.JWTTTLSeconds)*time.Second,
	)
	if err != nil {
		return nil, fmt.Errorf("internal JWT identity: %w", err)
	}
	slog.Info("internal JWT identity ready", "kid", cfg.JWTKID, "issuer", cfg.JWTIssuer)

	// SeedUsers is idempotent: existing demo/admin rows are left alone.
	// Failure is fatal — a gateway that cannot read/write users cannot serve.
	if err := auth.SeedUsers(context.Background(), queries, cfg.AdminEmail, cfg.AdminPass); err != nil {
		return nil, fmt.Errorf("seed users: %w", err)
	}

	s := &Server{
		port:    cfg.Port,
		Pool:    pool,
		Queries: queries,
	}

	s.AuthService = auth.NewService(queries)
	s.AuthHandler = auth.NewHandler(s.AuthService)
	s.KeysService = auth.NewKeysService(queries)
	s.KeysHandler = auth.NewKeysHandler(s.KeysService, issuer)
	s.UserHandler = user.NewHandler(user.NewService(queries))
	s.ServiceHandler = monitor.NewHandler(monitor.NewService(queries))
	s.CorefinanceClient = corefinance.New(cfg.CorefinanceURL)
	s.TokenIssuer = issuer

	return &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      s.RegisterRoutes(cfg),
		IdleTimeout:  time.Minute,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}, nil
}
