package monitor

import "time"

// UptimeBucket is one hour or day of checks. Checks == 0 means no data, not
// a failed bucket.
type UptimeBucket struct {
	StartAt    time.Time `json:"start_at"`
	Checks     int64     `json:"checks"`
	Successes  int64     `json:"successes"`
	AvgLatency float64   `json:"avg_latency"`
}

// CreateServiceRequest represents the request to create a new service
type CreateServiceRequest struct {
	Name                string  `json:"name" validate:"required,min=1,max=255"`
	URL                 string  `json:"url" validate:"required,url"`
	Icon                *string `json:"icon,omitempty" validate:"omitempty,max=50"`
	Description         *string `json:"description,omitempty"`
	ServiceType         *string `json:"service_type,omitempty" validate:"omitempty,max=100"`
	HealthCheckInterval *int32  `json:"health_check_interval,omitempty" validate:"omitempty,gt=0,lte=3600"`
	HealthCheckMethod   *string `json:"health_check_method,omitempty" validate:"omitempty,oneof=GET POST HEAD"`
	ExpectedStatusCodes []int32 `json:"expected_status_codes,omitempty" validate:"omitempty,dive,gt=99,lt=600"`
	Timeout             *int32  `json:"timeout,omitempty" validate:"omitempty,gt=0,lte=60000"`
}

// UpdateServiceRequest represents the request to update a service
type UpdateServiceRequest struct {
	Name                *string `json:"name,omitempty" validate:"omitempty,min=1,max=255"`
	URL                 *string `json:"url,omitempty" validate:"omitempty,url"`
	Icon                *string `json:"icon,omitempty" validate:"omitempty,max=50"`
	Description         *string `json:"description,omitempty"`
	ServiceType         *string `json:"service_type,omitempty" validate:"omitempty,max=100"`
	HealthCheckInterval *int32  `json:"health_check_interval,omitempty" validate:"omitempty,gt=0,lte=3600"`
	HealthCheckMethod   *string `json:"health_check_method,omitempty" validate:"omitempty,oneof=GET POST HEAD"`
	ExpectedStatusCodes []int32 `json:"expected_status_codes,omitempty" validate:"omitempty,dive,gt=99,lt=600"`
	Timeout             *int32  `json:"timeout,omitempty" validate:"omitempty,gt=0,lte=60000"`
	IsActive            *bool   `json:"is_active,omitempty"`
}
