// Package timezone holds the rules for a user's timezone (ADR-0005): which
// values count as one, and what an unset timezone reads as.
package timezone

import (
	"time"
	// The runtime image (alpine) ships no zoneinfo; embed it so
	// LoadLocation knows every IANA zone.
	_ "time/tzdata"

	"github.com/jackc/pgx/v5/pgtype"
)

// Default is the zone of a user who hasn't set one.
const Default = "UTC"

// Valid reports whether tz is an IANA zone name such as Asia/Manila.
// time.LoadLocation also accepts "" (UTC) and "Local" (the server's zone),
// which mean nothing for a user, so those are refused, as corefinance does.
func Valid(tz string) bool {
	if tz == "" || tz == "Local" {
		return false
	}
	_, err := time.LoadLocation(tz)
	return err == nil
}

// Effective is the zone a stored value reads as: the value when set, else
// Default.
func Effective(stored pgtype.Text) string {
	if stored.Valid && stored.String != "" {
		return stored.String
	}
	return Default
}
