package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestJWTAudienceList(t *testing.T) {
	old, had := os.LookupEnv("JWT_AUDIENCE")
	defer func() {
		if had {
			os.Setenv("JWT_AUDIENCE", old)
		} else {
			os.Unsetenv("JWT_AUDIENCE")
		}
	}()

	os.Setenv("JWT_AUDIENCE", "corefinance, corereminder ,,")
	if got := Load().JWTAudience; !reflect.DeepEqual(got, []string{"corefinance", "corereminder"}) {
		t.Fatalf("aud = %v, want [corefinance corereminder]", got)
	}
	os.Unsetenv("JWT_AUDIENCE")
	if got := Load().JWTAudience; !reflect.DeepEqual(got, []string{"corefinance", "coredraw"}) {
		t.Fatalf("default aud = %v, want [corefinance coredraw]", got)
	}
}

func TestKeyFileWinsOverInlinePEM(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jwt.pem")
	if err := os.WriteFile(path, []byte("FILE-PEM"), 0o600); err != nil {
		t.Fatalf("write key file: %v", err)
	}
	t.Setenv("JWT_PRIVATE_KEY_FILE", path)
	t.Setenv("JWT_PRIVATE_KEY_PEM", "ENV-PEM")
	t.Setenv("JWT_KID", "2026-09-a")

	cfg := Load()
	if cfg.JWTPrivateKeyPEM != "FILE-PEM" {
		t.Fatalf("key material = %q, want the file content", cfg.JWTPrivateKeyPEM)
	}
	if cfg.JWTKeySource != "JWT_PRIVATE_KEY_FILE="+path {
		t.Fatalf("key source = %q", cfg.JWTKeySource)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
}

func TestKeyFallsBackToInlinePEM(t *testing.T) {
	t.Setenv("JWT_PRIVATE_KEY_FILE", "")
	t.Setenv("JWT_PRIVATE_KEY_PEM", "ENV-PEM")

	cfg := Load()
	if cfg.JWTPrivateKeyPEM != "ENV-PEM" {
		t.Fatalf("key material = %q, want inline PEM", cfg.JWTPrivateKeyPEM)
	}
	if cfg.JWTKeySource != "JWT_PRIVATE_KEY_PEM" {
		t.Fatalf("key source = %q", cfg.JWTKeySource)
	}
}

func TestUnreadableKeyFileFailsValidation(t *testing.T) {
	t.Setenv("JWT_PRIVATE_KEY_FILE", filepath.Join(t.TempDir(), "missing.pem"))
	t.Setenv("JWT_PRIVATE_KEY_PEM", "")
	t.Setenv("JWT_KID", "2026-09-a")

	cfg := Load()
	if cfg.JWTPrivateKeyPEM != "" {
		t.Fatalf("key material should be empty, got %d bytes", len(cfg.JWTPrivateKeyPEM))
	}
	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected validation error for unreadable key file")
	}
	if !strings.Contains(err.Error(), "JWT_PRIVATE_KEY_FILE") {
		t.Fatalf("error should name the variable, got: %v", err)
	}
}
