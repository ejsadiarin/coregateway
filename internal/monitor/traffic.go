package monitor

import (
	"net/http"
	"time"
)

// failureWindow is how long a failed proxied request keeps a built-in
// service degraded. Only time clears it, not a green health check: health
// checks hit liveness, which can be green while the database is down.
const failureWindow = 10 * time.Minute

// Observe wraps the proxy to the built-in service with this key and records
// each request the downstream failed: a 5xx, including the gateway's 502
// when it can't reach it. Client errors (4xx) never count. This is passive
// health checking: real traffic shows a failure no liveness probe can,
// without the monitor querying any database.
func (s *Statuses) Observe(key string, next http.Handler) http.Handler {
	if s == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		if rec.status >= http.StatusInternalServerError {
			s.recordFailure(key)
		}
	})
}

func (s *Statuses) recordFailure(key string) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failures[key] = append(recent(s.failures[key], now), now)
}

// recentFailures is how many proxied requests to the built-in service failed
// in the last failureWindow, and when the latest did.
func (s *Statuses) recentFailures(key string) (int, time.Time) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := recent(s.failures[key], now)
	s.failures[key] = kept
	if len(kept) == 0 {
		return 0, time.Time{}
	}
	return len(kept), kept[len(kept)-1]
}

// recent drops failures older than the window from an oldest-first list.
func recent(times []time.Time, now time.Time) []time.Time {
	cutoff := now.Add(-failureWindow)
	for i, t := range times {
		if t.After(cutoff) {
			return times[i:]
		}
	}
	return nil
}

// statusRecorder notes the status the proxy wrote. Unwrap lets the proxy
// still flush streamed responses and hijack upgraded connections.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	if r.status == 0 {
		r.status = code
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(b)
}

func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }
