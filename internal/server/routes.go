package server

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/config"
	"github.com/ejsadiarin/coregateway/internal/helper"
	"github.com/ejsadiarin/coregateway/internal/middleware"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	swagger "github.com/swaggo/http-swagger"
)

type systemStats struct {
	CPU         int    `json:"cpu"`
	Memory      int    `json:"memory"`
	Storage     int    `json:"storage"`
	Temperature int    `json:"temperature"`
	Uptime      string `json:"uptime"`
	Network     struct {
		Up   string `json:"up"`
		Down string `json:"down"`
	} `json:"network"`
}

type serviceStatus struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Type   string `json:"type"`
}

func (s *Server) RegisterRoutes(cfg *config.Config) http.Handler {
	r := chi.NewRouter()

	r.Use(chiMiddleware.RequestID)
	r.Use(middleware.RequestIDResponseHeader)
	r.Use(middleware.SlogMiddleware)
	r.Use(auth.AuthMiddleware(s.AuthService))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:3000", "http://localhost:3001"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Request-ID", "X-User-ID"},
		AllowCredentials: true,
	}))

	// ops
	r.Get("/.well-known/jwks.json", s.ServeJWKS)
	r.Get("/swagger/*", swagger.WrapHandler)
	r.Get("/health", healthCheck)
	r.Get("/api/system/stats", getSystemStats)
	r.Get("/api/legacy/services", getLegacyServices)

	// auth
	r.Post("/api/auth/register", s.AuthHandler.Register)
	r.Post("/api/auth/login", s.AuthHandler.Login)
	r.Post("/api/auth/logout", s.AuthHandler.Logout)
	r.Post("/api/auth/demo", s.AuthHandler.LoginAsDemo)
	r.With(auth.RequireIdentity(s.AuthService, s.KeysService)).Get("/api/auth/me", s.AuthHandler.Me)

	// API key management: any authenticated caller may mint (owner is
	// always the caller); the handler rejects `admin`-scope requests from
	// non-admin-role callers. Plaintext appears in the create response
	// exactly once. List/revoke stay admin-only; key-authed callers
	// additionally need the admin scope for list/revoke.
	r.Route("/api/auth/keys", func(r chi.Router) {
		r.Use(auth.RequireIdentity(s.AuthService, s.KeysService))
		r.Use(auth.RequireAuth())
		r.Post("/", s.KeysHandler.Create)
		r.Group(func(r chi.Router) {
			r.Use(auth.RequireRole(auth.RoleAdmin))
			r.With(auth.RequireKeyScope("admin")).Get("/", s.KeysHandler.List)
			r.With(auth.RequireKeyScope("admin")).Delete("/{id}", s.KeysHandler.Revoke)
		})
	})

	// users — list/create/delete are admin-only. Get/Update stay ungated
	// at route level; their handlers enforce admin-or-self. Key-authed
	// callers need the admin scope for list/create/delete; self-reads
	// need identity only.
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireIdentity(s.AuthService, s.KeysService))
		r.Use(auth.RequireAuth(), auth.RequireRole(auth.RoleAdmin))
		r.With(auth.RequireKeyScope("admin")).Get("/api/users", s.UserHandler.ListUsers)
		r.With(auth.RequireKeyScope("admin")).Post("/api/users", s.UserHandler.CreateUser)
		r.With(auth.RequireKeyScope("admin")).Delete("/api/users/{id}", s.UserHandler.DeleteUser)
	})
	r.With(auth.RequireIdentity(s.AuthService, s.KeysService)).Get("/api/users/{id}", s.UserHandler.GetUser)
	r.With(auth.RequireIdentity(s.AuthService, s.KeysService)).Put("/api/users/{id}", s.UserHandler.UpdateUser)

	// services (monitor) — admin-only; key callers need the admin scope.
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireIdentity(s.AuthService, s.KeysService))
		r.Use(auth.RequireAuth(), auth.RequireRole(auth.RoleAdmin))
		r.Use(auth.RequireKeyScope("admin"))
		r.Post("/api/services", s.ServiceHandler.CreateService)
		r.Get("/api/services/list", s.ServiceHandler.ListServices)
		r.Get("/api/services/stats/all", s.ServiceHandler.GetAllServicesStats)
		r.Get("/api/services/{id}", s.ServiceHandler.GetService)
		r.Put("/api/services/{id}", s.ServiceHandler.UpdateService)
		r.Delete("/api/services/{id}", s.ServiceHandler.DeleteService)
		r.Get("/api/services/{id}/history", s.ServiceHandler.GetServiceHistory)
		r.Get("/api/services/{id}/stats", s.ServiceHandler.GetServiceStats)
	})

	// budget — authenticated at the edge, streamed to corefinance-api.
	// The internal JWT (not X-User-ID) is the only identity downstream.
	// chi prefers the static /admin segment over the /* catch-all, so
	// admin calls pass the scope gate before proxying.
	r.Route("/api/budget", func(r chi.Router) {
		// Existence check for ?user_id= targeting (user authority stays
		// in the gateway; downstream never looks up users).
		userExists := func(ctx context.Context, id uuid.UUID) (bool, error) {
			_, err := s.Queries.GetUser(ctx, id)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return false, nil
				}
				return false, err
			}
			return true, nil
		}
		r.Use(middleware.EdgeIdentity(s.TokenIssuer, s.KeysService, userExists))
		// Key-authed callers need service cover (read for GET/HEAD, write
		// otherwise); sessions pass through to downstream role checks.
		r.Use(auth.RequireServiceKeyScope("corefinance"))
		r.Use(middleware.ForwardHeaders())
		r.Route("/admin", func(r chi.Router) {
			r.Use(middleware.RequireScope("admin"))
			r.Handle("/*", s.CorefinanceClient.Proxy())
		})
		r.Handle("/*", s.CorefinanceClient.Proxy())
	})

	return r
}

func healthCheck(w http.ResponseWriter, r *http.Request) {
	helper.RespondJSON(w, http.StatusOK, map[string]string{
		"status": "healthy",
		"time":   time.Now().Format(time.RFC3339),
	})
}

func getSystemStats(w http.ResponseWriter, r *http.Request) {
	stats := systemStats{
		CPU:         15,
		Memory:      42,
		Storage:     68,
		Temperature: 45,
		Uptime:      "42d 13h 27m",
		Network: struct {
			Up   string `json:"up"`
			Down string `json:"down"`
		}{
			Up:   "125.4 Mbps",
			Down: "342.8 Mbps",
		},
	}

	helper.RespondJSON(w, http.StatusOK, stats)
}

func getLegacyServices(w http.ResponseWriter, r *http.Request) {
	services := []serviceStatus{
		{Name: "Docker Manager", Type: "Container", Status: "online"},
		{Name: "PostgreSQL", Type: "Database", Status: "online"},
		{Name: "Nextcloud", Type: "Storage", Status: "online"},
		{Name: "Vault", Type: "Security", Status: "online"},
		{Name: "Jellyfin", Type: "Media", Status: "offline"},
		{Name: "Mail Server", Type: "Email", Status: "maintenance"},
	}

	helper.RespondJSON(w, http.StatusOK, services)
}
