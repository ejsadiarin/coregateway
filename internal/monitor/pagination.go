package monitor

// Pagination default values
const (
	DefaultExpenseLimit = 5
	DefaultIncomeLimit  = 5
	MaxPageLimit        = 100
)

// PaginationParams represents pagination parameters for listings
type PaginationParams struct {
	Page  int `json:"page" query:"page" validate:"omitempty,min=1"`
	Limit int `json:"limit" query:"limit" validate:"omitempty,min=1,max=100"`
}

// OffsetPagination represents page-based pagination metadata
type OffsetPagination struct {
	Total      int64 `json:"total"`
	Page       int   `json:"page"`
	Limit      int   `json:"limit"`
	TotalPages int   `json:"totalPages"`
	HasMore    bool  `json:"hasMore"`
}

// PaginatedResponse represents a paginated API response
type PaginatedResponse[T any] struct {
	Data       []T              `json:"data"`
	Pagination OffsetPagination `json:"pagination"`
}
