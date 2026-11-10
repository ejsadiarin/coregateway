package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// preflight sends the browser's CORS preflight for method from origin and
// returns the response.
func preflight(t *testing.T, h http.Handler, origin, method string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodOptions, "/api/coreban/boards/x", nil)
	req.Header.Set("Origin", origin)
	req.Header.Set("Access-Control-Request-Method", method)
	req.Header.Set("Access-Control-Request-Headers", "content-type")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// Every method the dashboard sends must pass preflight from the dev
// server, or the browser shows only "Failed to fetch". PATCH regressed
// once: coreban's edits, moves and renames all failed under pnpm dev.
func TestCORSPreflightAllowsDashboardMethods(t *testing.T) {
	h := corsMiddleware("")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	for _, origin := range []string{"http://localhost:3000", "http://localhost:3001"} {
		for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			rec := preflight(t, h, origin, method)
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
				t.Errorf("%s from %s: Allow-Origin = %q, want %q", method, origin, got, origin)
			}
			if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
				t.Errorf("%s from %s: Allow-Credentials = %q, want true", method, origin, got)
			}
		}
	}
}

func TestCORSAllowedOriginsExtendDefaults(t *testing.T) {
	h := corsMiddleware(" http://100.64.0.1:3000 ,,")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	if got := preflight(t, h, "http://100.64.0.1:3000", http.MethodPatch).Header().Get("Access-Control-Allow-Origin"); got != "http://100.64.0.1:3000" {
		t.Errorf("extra origin: Allow-Origin = %q, want it allowed", got)
	}
	if got := preflight(t, h, "http://localhost:3001", http.MethodGet).Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3001" {
		t.Errorf("default origin dropped when ALLOWED_ORIGINS is set: Allow-Origin = %q", got)
	}
	if got := preflight(t, h, "http://evil.example", http.MethodGet).Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("unlisted origin: Allow-Origin = %q, want empty", got)
	}
}
