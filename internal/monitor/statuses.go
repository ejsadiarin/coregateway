package monitor

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

// Check is the latest health check of one monitored service. It lives only
// in the gateway's memory (#74): after a restart a service is unknown until
// the first round checks it.
type Check struct {
	Status       string    `json:"status"`
	ResponseTime int32     `json:"response_time,omitempty"`
	StatusCode   int32     `json:"status_code,omitempty"`
	Error        string    `json:"error,omitempty"`
	CheckedAt    time.Time `json:"checked_at"`
}

// Statuses holds each monitored service's latest check, and the failed
// requests the gateway proxied to each built-in service. Safe for concurrent
// use by the checker, the proxy and the API.
type Statuses struct {
	now func() time.Time

	mu       sync.RWMutex
	checks   map[uuid.UUID]Check
	failures map[string][]time.Time // by built-in key, oldest first
}

func NewStatuses() *Statuses {
	return &Statuses{
		now:      time.Now,
		checks:   make(map[uuid.UUID]Check),
		failures: make(map[string][]time.Time),
	}
}

func (s *Statuses) Set(id uuid.UUID, check Check) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checks[id] = check
}

func (s *Statuses) Get(id uuid.UUID) (Check, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	check, ok := s.checks[id]
	return check, ok
}

// keepOnly drops every service not in ids, so a paused or deleted service
// no longer shows its last result.
func (s *Statuses) keepOnly(ids map[uuid.UUID]bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id := range s.checks {
		if !ids[id] {
			delete(s.checks, id)
		}
	}
}
