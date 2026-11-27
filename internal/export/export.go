// Package export serves the official export and import bundle (ADR-0008):
// one JSON file with a versioned part per service. The gateway never looks
// inside a part. It asks each part's own endpoint through the gateway's own
// routes, so every part request is authenticated, scope-checked, targeted
// and minted exactly like any other proxied request.
package export

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/helper"
)

const (
	Format  = "coregateway.export"
	Version = 1
	Schema  = "https://raw.githubusercontent.com/ejsadiarin/coregateway/main/schemas/export.v1.json"

	// MaxImportBytes caps an import body.
	MaxImportBytes = 25 << 20

	StatusImported = "imported"
	StatusSkipped  = "skipped"
	StatusFailed   = "failed"
)

// Part is one service's slice of an export, reached through the gateway's
// own routes.
type Part struct {
	Name       string // the key under "parts"
	Format     string // the part's own format, e.g. coregateway.budget
	Downstream string // the service whose key scopes cover it; "" needs none
	ExportPath string
	ImportPath string
	// ExportOnly parts are for reference: import reports them skipped.
	ExportOnly bool
	// Legacy reports whether a file with no format is this part's
	// unversioned export (its version 0).
	Legacy func(top map[string]json.RawMessage) bool
}

// Budget is corefinance's part.
var Budget = Part{
	Name: "budget", Format: "coregateway.budget", Downstream: "corefinance",
	ExportPath: "/api/budget/export", ImportPath: "/api/budget/import",
	Legacy: hasAnyKey("expenses", "incomes", "tags", "recurring_expenses", "recurring_incomes"),
}

// Kanban is coreban's part: boards, reminders and Feed notes.
var Kanban = Part{
	Name: "kanban", Format: "coregateway.kanban", Downstream: "coreban",
	ExportPath: "/api/coreban/export", ImportPath: "/api/coreban/import",
}

// Draw is coredraw's part: whiteboards, each saved whole.
var Draw = Part{
	Name: "draw", Format: "coregateway.draw", Downstream: "coredraw",
	ExportPath: "/api/coredraw/export", ImportPath: "/api/coredraw/import",
}

// Parts is every part this gateway offers, in export order.
var Parts = []Part{Budget, Kanban, Draw, Account}

// Bundle is the export file.
type Bundle struct {
	Schema     string                     `json:"$schema"`
	Format     string                     `json:"format"`
	Version    int                        `json:"version"`
	ExportedAt time.Time                  `json:"exported_at"`
	Parts      map[string]json.RawMessage `json:"parts"`
}

// ImportResponse reports each part's result as its service gave it.
type ImportResponse struct {
	DryRun bool                       `json:"dry_run"`
	Parts  map[string]json.RawMessage `json:"parts"`
}

// PartResult is a result the gateway writes itself, for a part it skipped
// or one whose service gave no result.
type PartResult struct {
	Part   string      `json:"part"`
	Format string      `json:"format,omitempty"`
	DryRun bool        `json:"dry_run"`
	Status string      `json:"status"`
	Counts struct{}    `json:"counts"`
	Errors []PartError `json:"errors"`
}

type PartError struct {
	Entity string `json:"entity"`
	Reason string `json:"reason"`
}

// ZoneFunc names a user's timezone, for dating the file.
type ZoneFunc func(ctx context.Context, userID uuid.UUID) string

type Handler struct {
	parts  []Part
	zone   ZoneFunc
	now    func() time.Time
	router http.Handler
}

func NewHandler(parts []Part, zone ZoneFunc) *Handler {
	return &Handler{parts: parts, zone: zone, now: time.Now}
}

// Mount gives the handler the gateway's router, which serves the parts.
func (h *Handler) Mount(router http.Handler) { h.router = router }

// Export serves GET /api/export?parts=a,b[&user_id=]. A bundle, unless
// ?parts= names one part: then it is that part's own file. Without
// ?parts= a key gets every part its scopes can read.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	parts, _, ok := h.pick(w, r, h.parts, false)
	if !ok {
		return
	}
	query := url.Values{}
	if target := r.URL.Query().Get("user_id"); target != "" {
		query.Set("user_id", target)
	}

	files := map[string]json.RawMessage{}
	for _, p := range parts {
		rec := h.sub(r, http.MethodGet, p.ExportPath, query, nil)
		if rec.Code != http.StatusOK {
			slog.Warn("export: part failed", "part", p.Name, "status", rec.Code)
			helper.RespondErrorJSON(w, rec.Code, p.Name+" part: "+errorMessage(rec))
			return
		}
		files[p.Name] = rec.Body.Bytes()
	}

	user := auth.GetUserFromContext(r)
	date := h.now().In(h.location(r.Context(), user.ID)).Format("2006-01-02")
	name := "coregateway-export-" + date + ".json"
	var body any = Bundle{Schema: Schema, Format: Format, Version: Version,
		ExportedAt: h.now().UTC().Truncate(time.Second), Parts: files}
	if len(parts) == 1 && r.URL.Query().Get("parts") != "" {
		name = "coregateway-" + parts[0].Name + "-" + date + ".json"
		body = files[parts[0].Name]
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	helper.RespondJSON(w, http.StatusOK, body)
}

// Import serves POST /api/import?parts=a,b&dry_run=true. The body is a
// bundle or one part's file. Each chosen part goes to its own service and
// reports its own result; one failing doesn't stop the others.
func (h *Handler) Import(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUserFromContext(r)
	if user.Role == auth.RoleGuest {
		helper.RespondErrorJSON(w, http.StatusForbidden, "The demo account can't import. Create an account to keep your data")
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxImportBytes))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			helper.RespondErrorJSON(w, http.StatusRequestEntityTooLarge, "import file is larger than 25 MB")
			return
		}
		helper.RespondErrorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	inFile, err := h.read(raw)
	if err != nil {
		helper.RespondErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	known := []Part{}
	unknown := []string{}
	for name := range inFile {
		if p, ok := h.byName(name); ok {
			known = append(known, p)
		} else {
			unknown = append(unknown, name)
		}
	}
	slices.SortFunc(known, func(a, b Part) int { return h.order(a) - h.order(b) })
	slices.Sort(unknown)
	parts, denied, ok := h.pick(w, r, known, true)
	if !ok {
		return
	}

	dryRun := r.URL.Query().Get("dry_run") == "true"
	query := url.Values{}
	if dryRun {
		query.Set("dry_run", "true")
	}
	results := map[string]json.RawMessage{}
	for _, p := range parts {
		if p.ExportOnly {
			results[p.Name] = mustJSON(PartResult{Part: p.Name, Format: p.Format, DryRun: dryRun, Status: StatusSkipped,
				Errors: []PartError{{Entity: "part", Reason: "the " + p.Name + " part is for reference; importing it changes nothing"}}})
			continue
		}
		rec := h.sub(r, http.MethodPost, p.ImportPath, query, inFile[p.Name])
		results[p.Name] = partResult(p, dryRun, rec)
	}
	for name, need := range denied {
		results[name] = mustJSON(PartResult{Part: name, DryRun: dryRun, Status: StatusSkipped,
			Errors: []PartError{{Entity: "part", Reason: "this key needs the " + need + " scope"}}})
	}
	if r.URL.Query().Get("parts") == "" {
		for _, name := range unknown {
			results[name] = mustJSON(PartResult{Part: name, DryRun: dryRun, Status: StatusSkipped,
				Errors: []PartError{{Entity: "part", Reason: "this gateway has no " + name + " part"}}})
		}
	}
	helper.RespondJSON(w, http.StatusOK, ImportResponse{DryRun: dryRun, Parts: results})
}

// read splits an import body into its parts' files.
func (h *Handler) read(raw []byte) (map[string]json.RawMessage, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		return nil, errors.New("the file is not JSON")
	}
	f, hasFormat := top["format"]
	if !hasFormat {
		for _, p := range h.parts {
			if p.Legacy != nil && p.Legacy(top) {
				return map[string]json.RawMessage{p.Name: raw}, nil
			}
		}
		return nil, errors.New("the file has no format: it is not an export")
	}
	var format string
	if err := json.Unmarshal(f, &format); err != nil {
		return nil, errors.New("the file's format is not a string")
	}
	if format != Format {
		for _, p := range h.parts {
			if p.Format == format {
				return map[string]json.RawMessage{p.Name: raw}, nil
			}
		}
		return nil, fmt.Errorf("unknown format %q", format)
	}
	var b struct {
		Version int                        `json:"version"`
		Parts   map[string]json.RawMessage `json:"parts"`
	}
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, fmt.Errorf("the bundle is malformed: %v", err)
	}
	if b.Version < 1 || b.Version > Version {
		return nil, fmt.Errorf("bundle version %d is not supported (this gateway reads up to %d)", b.Version, Version)
	}
	if len(b.Parts) == 0 {
		return nil, errors.New("the bundle has no parts")
	}
	return b.Parts, nil
}

// pick chooses the parts named by ?parts= among those available, and
// checks a key caller's scopes cover them before anything is sent: read to
// export, write to import. A named part the key can't reach is a 403.
// Without ?parts= it is every available part the caller can reach; the
// rest come back as denied, with the scope each needs.
func (h *Handler) pick(w http.ResponseWriter, r *http.Request, available []Part, write bool) (chosen []Part, denied map[string]string, ok bool) {
	named := r.URL.Query().Get("parts") != ""
	chosen = available
	if named {
		chosen = nil
		for _, name := range strings.Split(r.URL.Query().Get("parts"), ",") {
			name = strings.TrimSpace(name)
			i := slices.IndexFunc(available, func(p Part) bool { return p.Name == name })
			if i < 0 {
				where := "this gateway has no"
				if write {
					where = "the file has no"
				}
				helper.RespondErrorJSON(w, http.StatusBadRequest, where+" "+name+" part")
				return nil, nil, false
			}
			if !slices.ContainsFunc(chosen, func(p Part) bool { return p.Name == name }) {
				chosen = append(chosen, available[i])
			}
		}
	}
	if len(chosen) == 0 {
		helper.RespondErrorJSON(w, http.StatusBadRequest, "no parts to export or import")
		return nil, nil, false
	}
	scopes, isKey := auth.KeyScopesFromContext(r)
	if !isKey {
		return chosen, nil, true
	}
	op := "read"
	if write {
		op = "write"
	}
	var reachable []Part
	denied = map[string]string{}
	for _, p := range chosen {
		need := p.Downstream + ":" + op
		switch {
		case p.Downstream == "" || auth.KeyCoversScope(scopes, need):
			reachable = append(reachable, p)
		case named:
			helper.RespondErrorJSON(w, http.StatusForbidden, "the "+p.Name+" part needs the "+need+" scope")
			return nil, nil, false
		default:
			denied[p.Name] = need
		}
	}
	if len(reachable) == 0 {
		helper.RespondErrorJSON(w, http.StatusForbidden, "this key can't "+map[bool]string{false: "export", true: "import"}[write]+
			" any part: the "+chosen[0].Name+" part needs the "+chosen[0].Downstream+":"+op+" scope")
		return nil, nil, false
	}
	return reachable, denied, true
}

// sub serves one part request through the gateway's routes, as the
// caller: their cookie or key travels, nothing from this request's context
// does, so the part route authenticates the caller afresh.
func (h *Handler) sub(r *http.Request, method, path string, query url.Values, body []byte) *httptest.ResponseRecorder {
	req, _ := http.NewRequestWithContext(valuesFree{r.Context()}, method, path, bytes.NewReader(body))
	req.URL.RawQuery = query.Encode()
	req.RemoteAddr = r.RemoteAddr
	for _, k := range []string{"Cookie", "Authorization", "X-Request-ID", "User-Agent"} {
		if v := r.Header.Get(k); v != "" {
			req.Header.Set(k, v)
		}
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec
}

// partResult is the service's own result when it gave one, else a failed
// result naming why.
func partResult(p Part, dryRun bool, rec *httptest.ResponseRecorder) json.RawMessage {
	if rec.Code == http.StatusOK || rec.Code == http.StatusUnprocessableEntity {
		var probe struct {
			Status string `json:"status"`
		}
		if json.Unmarshal(rec.Body.Bytes(), &probe) == nil && probe.Status != "" {
			return rec.Body.Bytes()
		}
	}
	slog.Warn("import: part failed", "part", p.Name, "status", rec.Code)
	return mustJSON(PartResult{Part: p.Name, Format: p.Format, DryRun: dryRun, Status: StatusFailed,
		Errors: []PartError{{Entity: "part", Reason: errorMessage(rec)}}})
}

func errorMessage(rec *httptest.ResponseRecorder) string {
	var e struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(rec.Body.Bytes(), &e) == nil && e.Error != "" {
		return e.Error
	}
	return http.StatusText(rec.Code)
}

func (h *Handler) byName(name string) (Part, bool) {
	i := slices.IndexFunc(h.parts, func(p Part) bool { return p.Name == name })
	if i < 0 {
		return Part{}, false
	}
	return h.parts[i], true
}

func (h *Handler) order(p Part) int {
	return slices.IndexFunc(h.parts, func(q Part) bool { return q.Name == p.Name })
}

func (h *Handler) location(ctx context.Context, userID uuid.UUID) *time.Location {
	if h.zone != nil {
		if tz := h.zone(ctx, userID); tz != "" {
			if loc, err := time.LoadLocation(tz); err == nil {
				return loc
			}
		}
	}
	return time.UTC
}

func hasAnyKey(keys ...string) func(map[string]json.RawMessage) bool {
	return func(top map[string]json.RawMessage) bool {
		for _, k := range keys {
			if _, ok := top[k]; ok {
				return true
			}
		}
		return false
	}
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

// valuesFree keeps a context's cancellation and deadline but none of its
// values: no identity, key scopes or chi route state leak into a part
// request.
type valuesFree struct{ context.Context }

func (valuesFree) Value(any) any { return nil }
