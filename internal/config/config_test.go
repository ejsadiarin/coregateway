package config

import (
	"os"
	"reflect"
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
	if got := Load().JWTAudience; !reflect.DeepEqual(got, []string{"corefinance"}) {
		t.Fatalf("default aud = %v, want [corefinance]", got)
	}
}
