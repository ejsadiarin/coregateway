package monitor

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	sqlc "github.com/ejsadiarin/coregateway/internal/db/sqlc"
)

func TestUptimeBuckets_Integration(t *testing.T) {
	queries, pool := setupBuiltinDB(t)
	ctx := context.Background()

	service, err := queries.CreateService(ctx, sqlc.CreateServiceParams{
		Name:                "probe",
		Url:                 "http://probe/health",
		ServiceType:         pgtype.Text{String: "custom", Valid: true},
		HealthCheckInterval: pgtype.Int4{Int32: 60, Valid: true},
		HealthCheckMethod:   pgtype.Text{String: "GET", Valid: true},
		Timeout:             pgtype.Int4{Int32: 5000, Valid: true},
	})
	if err != nil {
		t.Fatalf("create service: %v", err)
	}

	base := time.Now().UTC().Truncate(time.Hour)
	rows := []struct {
		at     time.Time
		status string
		ms     int32
	}{
		{base.Add(-110 * time.Minute), "online", 100},
		{base.Add(-50 * time.Minute), "offline", 200},
		// The current hour's start: never in the future, unlike a fixed
		// offset into the hour (the query counts checks up to now, so
		// base+5m failed during the first five minutes of every hour).
		{base, "online", 300},
	}
	for _, row := range rows {
		if _, err := pool.Exec(ctx,
			`INSERT INTO coregateway.service_health_history (service_id, status, response_time, checked_at)
			 VALUES ($1, $2, $3, $4)`,
			service.ID, row.status, row.ms, row.at); err != nil {
			t.Fatalf("insert history: %v", err)
		}
	}

	svc := NewService(queries)
	buckets, err := svc.UptimeBuckets(ctx, service.ID, "hour", 3)
	if err != nil {
		t.Fatalf("uptime buckets: %v", err)
	}
	if len(buckets) != 3 {
		t.Fatalf("buckets = %d, want 3", len(buckets))
	}
	for i, bucket := range buckets {
		wantStart := base.Add(time.Duration(i-2) * time.Hour)
		if !bucket.StartAt.Equal(wantStart) {
			t.Errorf("bucket %d start = %s, want %s", i, bucket.StartAt, wantStart)
		}
		if bucket.Checks != 1 {
			t.Errorf("bucket %d checks = %d, want 1", i, bucket.Checks)
		}
	}
	if buckets[0].Successes != 1 || buckets[1].Successes != 0 || buckets[2].Successes != 1 {
		t.Errorf("successes = %d,%d,%d", buckets[0].Successes, buckets[1].Successes, buckets[2].Successes)
	}
	if buckets[0].AvgLatency != 100 || buckets[1].AvgLatency != 200 || buckets[2].AvgLatency != 300 {
		t.Errorf("latencies = %v,%v,%v", buckets[0].AvgLatency, buckets[1].AvgLatency, buckets[2].AvgLatency)
	}

	// A brand-new service has the same contiguous buckets, all marked empty.
	empty, err := queries.CreateService(ctx, sqlc.CreateServiceParams{
		Name:                "new",
		Url:                 "http://new/health",
		ServiceType:         pgtype.Text{String: "custom", Valid: true},
		HealthCheckInterval: pgtype.Int4{Int32: 60, Valid: true},
		HealthCheckMethod:   pgtype.Text{String: "GET", Valid: true},
		Timeout:             pgtype.Int4{Int32: 5000, Valid: true},
	})
	if err != nil {
		t.Fatalf("create empty service: %v", err)
	}
	emptyBuckets, err := svc.UptimeBuckets(ctx, empty.ID, "day", 30)
	if err != nil {
		t.Fatalf("empty uptime buckets: %v", err)
	}
	if len(emptyBuckets) != 30 {
		t.Fatalf("empty buckets = %d, want 30", len(emptyBuckets))
	}
	for _, bucket := range emptyBuckets {
		if bucket.Checks != 0 {
			t.Errorf("empty bucket checks = %d, want 0", bucket.Checks)
		}
	}
}
