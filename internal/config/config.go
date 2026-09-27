package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// Config holds application configuration
type Config struct {
	DatabaseURL         string
	Port                int
	Env                 string
	FrontendURL         string
	HealthCheckInterval time.Duration
	AdminEmail          string
	AdminPass           string
	AllowedOrigins      string
	CorefinanceURL      string
	// Internal JWT identity (gateway is the sole signer).
	JWTPrivateKeyPEM     string
	JWTPrevPrivateKeyPEM string
	JWTKID               string
	JWTPrevKID           string
	JWTIssuer            string
	// JWTAudience lists every downstream the minted tokens are valid for.
	// Comma-separated in JWT_AUDIENCE (e.g. "corefinance,corereminder").
	JWTAudience   []string
	JWTTTLSeconds int
}

// Load loads configuration from environment variables
func Load() *Config {
	return &Config{
		DatabaseURL:          getEnv("DATABASE_URL", "postgresql://core:core@localhost:5432/core?sslmode=disable"),
		Port:                 getEnvInt("PORT", 8080),
		Env:                  getEnv("ENV", "development"),
		HealthCheckInterval:  60 * time.Second,
		AdminEmail:           os.Getenv("ADMIN_EMAIL"),
		AdminPass:            os.Getenv("ADMIN_PASSWORD"),
		AllowedOrigins:       getEnv("ALLOWED_ORIGINS", "http://localhost:3000"),
		CorefinanceURL:       getEnv("COREFINANCE_URL", "http://localhost:6969"),
		JWTPrivateKeyPEM:     os.Getenv("JWT_PRIVATE_KEY_PEM"),
		JWTPrevPrivateKeyPEM: os.Getenv("JWT_PREV_PRIVATE_KEY_PEM"),
		JWTKID:               os.Getenv("JWT_KID"),
		JWTPrevKID:           os.Getenv("JWT_PREV_KID"),
		JWTIssuer:            getEnv("JWT_ISSUER", "https://gateway.internal"),
		JWTAudience:          getEnvList("JWT_AUDIENCE", "corefinance"),
		JWTTTLSeconds:        getEnvInt("JWT_TTL_SECONDS", 300),
	}
}

// IsProduction returns true if running in production mode
func (c *Config) IsProduction() bool {
	return c.Env == "production"
}

func (c *Config) Validate() error {
	if c.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	// Internal JWT identity is required in every environment (dev included):
	// without key material the gateway must refuse to start rather than run
	// unable to create tokens. Full PEM parsing happens in token.NewIssuer.
	if c.JWTPrivateKeyPEM == "" {
		return fmt.Errorf("JWT_PRIVATE_KEY_PEM is required")
	}
	if c.JWTKID == "" {
		return fmt.Errorf("JWT_KID is required")
	}
	if c.JWTPrevPrivateKeyPEM != "" && c.JWTPrevKID == "" {
		return fmt.Errorf("JWT_PREV_KID is required when JWT_PREV_PRIVATE_KEY_PEM is set")
	}
	if c.JWTIssuer == "" {
		return fmt.Errorf("JWT_ISSUER is required")
	}
	if len(c.JWTAudience) == 0 {
		return fmt.Errorf("JWT_AUDIENCE is required")
	}
	if c.JWTTTLSeconds <= 0 {
		return fmt.Errorf("JWT_TTL_SECONDS must be positive")
	}
	return nil
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}

// getEnvList reads a comma-separated env var into trimmed, non-empty
// entries (e.g. JWT_AUDIENCE="corefinance,corereminder").
func getEnvList(key, defaultValue string) []string {
	raw := getEnv(key, defaultValue)
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func getEnvInt(key string, defaultValue int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n
		}
	}
	return defaultValue
}
