package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/ejsadiarin/coregateway/internal/config"
	dbpkg "github.com/ejsadiarin/coregateway/internal/db"
	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/ejsadiarin/coregateway/internal/logger"
	monitor "github.com/ejsadiarin/coregateway/internal/monitor"
	"github.com/ejsadiarin/coregateway/internal/server"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	logger.Setup()

	cfg := config.Load()

	if err := cfg.Validate(); err != nil {
		log.Fatalf("Invalid configuration: %v", err)
	}

	pool, err := dbpkg.NewPool(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()

	queries := sqlc.New(pool)

	healthChecker := monitor.NewHealthChecker(queries)
	if cfg.HealthCheckInterval > 0 {
		healthChecker.StartHealthCheckScheduler(cfg.HealthCheckInterval)
	}

	srv, err := server.New(cfg, pool, queries)
	if err != nil {
		log.Fatalf("Failed to initialize server: %v", err)
	}

	go startSessionCleanup(queries)

	done := make(chan bool, 1)
	go gracefulShutdown(srv, done)

	log.Println("Starting coregateway...")
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("Server error: %v", err)
	}

	<-done
	log.Println("Graceful shutdown complete")
}

func gracefulShutdown(srv *http.Server, done chan bool) {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	<-ctx.Done()

	log.Println("shutting down gracefully, press Ctrl+C again to force")
	stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown with error: %v", err)
	}

	log.Println("Server exiting")
	done <- true
}

func startSessionCleanup(queries *sqlc.Queries) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	log.Println("Session cleanup scheduler started")

	for range ticker.C {
		if err := queries.DeleteExpiredSessions(context.Background()); err != nil {
			log.Printf("Failed to delete expired sessions: %v", err)
		}
	}
}
