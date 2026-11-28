package server

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/ejsadiarin/coregateway/internal/auth"
	"github.com/ejsadiarin/coregateway/internal/config"
	db "github.com/ejsadiarin/coregateway/internal/db/sqlc"
	"github.com/ejsadiarin/coregateway/internal/export"
	"github.com/ejsadiarin/coregateway/internal/services/coreban"
	"github.com/ejsadiarin/coregateway/internal/services/coredraw"
	"github.com/ejsadiarin/coregateway/internal/services/corefinance"
	"github.com/ejsadiarin/coregateway/internal/token"
)

const testGuestKeyPlaintext = "cgk_guest_export_test_key_0000000000000000"

// fakeBudget is corefinance's part endpoints: export returns a fixed part,
// import answers with a part result, failing a body that says "refuse" and
// erroring on one that says "explode".
type fakeBudget struct {
	missing string // a path answered 404, as by a service without its part
	mu      sync.Mutex
	imports []string
	query   []string
	sub     []string
	// fields is each multipart kanban import's fields, by name.
	fields []map[string]string
}

// The fake kanban part's attachments: a photo, and a video whose file is
// missing but whose poster is there.
const (
	fakePhoto = "11111111-1111-4111-8111-111111111111"
	fakeVideo = "22222222-2222-4222-8222-222222222222"
)

func (f *fakeBudget) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var claims token.Claims
	if parts := strings.Split(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), "."); len(parts) == 3 {
		payload, _ := jsonB64(parts[1])
		_ = json.Unmarshal(payload, &claims)
	}
	f.sub = append(f.sub, claims.Subject+"|"+claims.ActAs)
	f.query = append(f.query, r.URL.RawQuery)
	w.Header().Set("Content-Type", "application/json")
	if r.URL.Path == f.missing {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	switch r.URL.Path {
	case "/api/coredraw/export":
		_, _ = io.WriteString(w, `{"format":"coregateway.draw","version":1,"exported_at":"2026-11-27T00:00:00Z","data":{"boards":[]}}`)
	case "/api/coredraw/import":
		body, _ := io.ReadAll(r.Body)
		f.imports = append(f.imports, string(body))
		_ = json.NewEncoder(w).Encode(map[string]any{"part": "draw", "status": "imported", "dry_run": r.URL.Query().Get("dry_run") == "true"})
	case "/api/coreban/export":
		_, _ = io.WriteString(w, `{"format":"coregateway.kanban","version":1,"exported_at":"2026-11-27T00:00:00Z","data":{"boards":[],"notes":[`+
			`{"id":"33333333-3333-4333-8333-333333333333","attachments":[{"id":"`+fakePhoto+`","content_type":"image/webp","size_bytes":11,"poster_bytes":null},{"id":"`+fakeVideo+`","content_type":"video/mp4","size_bytes":5,"poster_bytes":3}]}]}}`)
	case "/api/coreban/export/media/" + fakePhoto:
		if r.URL.Query().Get("poster") != "" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "image/webp")
		_, _ = io.WriteString(w, "photo-bytes")
	case "/api/coreban/export/media/" + fakeVideo:
		if r.URL.Query().Get("poster") != "true" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":"this file isn't in storage"}`)
			return
		}
		_, _ = io.WriteString(w, "pst")
	case "/api/coreban/import":
		if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			fields := map[string]string{}
			mr, err := r.MultipartReader()
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			p, err := mr.NextPart()
			for ; err == nil; p, err = mr.NextPart() {
				b, _ := io.ReadAll(p)
				fields[p.FormName()] = string(b)
			}
			if err != io.EOF {
				fields["error"] = err.Error()
			}
			f.fields = append(f.fields, fields)
			f.imports = append(f.imports, fields["part"])
			_ = json.NewEncoder(w).Encode(map[string]any{"part": "kanban", "status": "imported", "dry_run": r.URL.Query().Get("dry_run") == "true"})
			return
		}
		body, _ := io.ReadAll(r.Body)
		f.imports = append(f.imports, string(body))
		_ = json.NewEncoder(w).Encode(map[string]any{"part": "kanban", "status": "imported", "dry_run": r.URL.Query().Get("dry_run") == "true"})
	case "/api/budget/export":
		_, _ = io.WriteString(w, `{"$schema":"x","format":"coregateway.budget","version":1,"exported_at":"2026-11-27T00:00:00Z","data":{"expenses":[]}}`)
	case "/api/budget/import":
		body, _ := io.ReadAll(r.Body)
		f.imports = append(f.imports, string(body))
		dry := r.URL.Query().Get("dry_run") == "true"
		switch {
		case strings.Contains(string(body), "explode"):
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, `{"error":"database unreachable"}`)
		case strings.Contains(string(body), "refuse"):
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]any{"part": "budget", "status": "failed", "dry_run": dry,
				"errors": []map[string]string{{"entity": "expense", "reason": "date is not a date"}}})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"part": "budget", "status": "imported", "dry_run": dry,
				"counts": map[string]any{"expenses": map[string]int{"created": 0, "skipped": 1}}})
		}
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func jsonB64(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

func exportSetup(t *testing.T) (http.Handler, *fakeBudget, *keyAuthStubQuerier) {
	t.Helper()
	_, q, _, userID := keyAuthTestSetup(t)
	u := q.users[userID]
	u.Timezone = pgtype.Text{String: "Asia/Manila", Valid: true}
	q.users[userID] = u
	guestID := uuid.New()
	q.users[guestID] = db.CoregatewayUser{ID: guestID, Email: "guest@example.com", Role: auth.RoleGuest}
	q.keyByHash[auth.HashAPIKey(testGuestKeyPlaintext)] = db.CoregatewayApiKey{ID: uuid.New(), OwnerUserID: guestID, Scopes: []string{"corefinance:write"}}

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	iss, err := token.NewIssuer(token.Key{KID: "k", Private: priv, Public: pub}, nil,
		"https://gateway.internal", []string{"corefinance", "coreban", "coredraw"}, 300*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	fake := &fakeBudget{}
	downstream := httptest.NewServer(fake)
	t.Cleanup(downstream.Close)
	s := &Server{
		TokenIssuer:       iss,
		CorefinanceClient: corefinance.New(downstream.URL),
		CorebanClient:     coreban.New(downstream.URL),
		CoredrawClient:    coredraw.New(downstream.URL),
		KeysService:       auth.NewKeysService(q),
		AuthService:       auth.NewService(q),
	}
	return s.RegisterRoutes(&config.Config{}), fake, q
}

func TestExportBundle(t *testing.T) {
	t.Run("a bundle with the budget part validates against the schema", func(t *testing.T) {
		h, fake, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?parts=budget,budget", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
		// One part asked for (twice) is that part's own file.
		if got := rec.Header().Get("Content-Disposition"); !strings.Contains(got, "coregateway-budget-") {
			t.Errorf("Content-Disposition = %q", got)
		}
		if !strings.Contains(rec.Body.String(), `"format":"coregateway.budget"`) {
			t.Errorf("body = %s", rec.Body)
		}
		if len(fake.query) != 1 {
			t.Errorf("part asked for %d times, want 1", len(fake.query))
		}
	})

	t.Run("the default export is a bundle that validates", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodGet, "/api/export", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
		today := time.Now().In(mustZone(t, "Asia/Manila")).Format("2006-01-02")
		if got := rec.Header().Get("Content-Disposition"); !strings.Contains(got, "coregateway-export-"+today+".json") {
			t.Errorf("Content-Disposition = %q, want the date in the owner's zone", got)
		}
		validate(t, rec.Body.Bytes())
		// A key gets the parts its scopes can read: this one, budget and
		// the account part, which needs no service scope.
		var b export.Bundle
		mustDecode(t, rec.Body.Bytes(), &b)
		if _, ok := b.Parts["budget"]; !ok || len(b.Parts) != 2 || b.Parts["account"] == nil {
			t.Errorf("parts = %v, want budget and account", b.Parts)
		}
	})

	t.Run("a session exports every part", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export", "")
		var b export.Bundle
		mustDecode(t, rec.Body.Bytes(), &b)
		if len(b.Parts) != 4 {
			t.Errorf("parts = %v, want budget, kanban, draw and account", b.Parts)
		}
		validate(t, rec.Body.Bytes())
		account := string(b.Parts["account"])
		if !strings.Contains(account, `"email":"admin@example.com"`) || strings.Contains(account, "password") {
			t.Errorf("account = %s", account)
		}
	})

	t.Run("naming a part the key can't read is a 403", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodGet, "/api/export?parts=budget,kanban", "")
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "coreban:read") {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
	})

	t.Run("a key without the part's read scope is refused before any part is asked", func(t *testing.T) {
		h, fake, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testCorebanReadKeyPlaintext, http.MethodGet, "/api/export?parts=budget", "")
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "corefinance:read") {
			t.Fatalf("status = %d, body %s; want 403 naming corefinance:read", rec.Code, rec.Body)
		}
		if len(fake.query) != 0 {
			t.Errorf("downstream asked %d times", len(fake.query))
		}
	})

	t.Run("a service without its part yet is left out of a default export", func(t *testing.T) {
		h, fake, _ := exportSetup(t)
		fake.missing = "/api/coredraw/export"
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export", "")
		var b export.Bundle
		mustDecode(t, rec.Body.Bytes(), &b)
		if rec.Code != http.StatusOK || b.Parts["draw"] != nil || b.Parts["budget"] == nil {
			t.Fatalf("status = %d, parts %v", rec.Code, b.Parts)
		}
		if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?parts=draw", ""); rec.Code != http.StatusNotFound {
			t.Errorf("named: status = %d, want 404", rec.Code)
		}
	})

	t.Run("an unknown part is a 400", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?parts=nope", "")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d", rec.Code)
		}
	})

	t.Run("a targeted read reaches the part as act_as", func(t *testing.T) {
		h, fake, q := exportSetup(t)
		var target uuid.UUID
		for id, u := range q.users {
			if u.Role == auth.RoleUser {
				target = id
			}
		}
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?user_id="+target.String(), "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
		if got := fake.sub[0]; !strings.HasSuffix(got, "|"+target.String()) {
			t.Errorf("token sub|act_as = %q, want act_as %s", got, target)
		}
	})

	t.Run("only an admin reads another user's account", func(t *testing.T) {
		h, _, q := exportSetup(t)
		var admin uuid.UUID
		for id, u := range q.users {
			if u.Role == auth.RoleAdmin {
				admin = id
			}
		}
		rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodGet, "/api/account/export?user_id="+admin.String(), "")
		if rec.Code != http.StatusForbidden {
			t.Errorf("user key: status = %d", rec.Code)
		}
		rec = doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?parts=account&user_id="+admin.String(), "")
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"format":"coregateway.account"`) {
			t.Errorf("admin key: status = %d, body %s", rec.Code, rec.Body)
		}
	})

	t.Run("anonymous is a 401", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		if rec := doKeyRequest(t, h, "", http.MethodGet, "/api/export", ""); rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d", rec.Code)
		}
	})
}

func TestImportBundle(t *testing.T) {
	bundle := func(budget string) string {
		return `{"format":"coregateway.export","version":1,"exported_at":"2026-11-27T00:00:00Z","parts":{"budget":` + budget + `}}`
	}
	part := `{"format":"coregateway.budget","version":1,"data":{"expenses":[]}}`

	t.Run("a bundle imports each part and reports its result", func(t *testing.T) {
		h, fake, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import?dry_run=true", bundle(part))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
		var got export.ImportResponse
		mustDecode(t, rec.Body.Bytes(), &got)
		if !got.DryRun || !strings.Contains(string(got.Parts["budget"]), `"status":"imported"`) {
			t.Errorf("response = %s", rec.Body)
		}
		if fake.query[0] != "dry_run=true" || fake.imports[0] != part {
			t.Errorf("downstream got query %q body %q", fake.query[0], fake.imports[0])
		}
	})

	t.Run("a bare part file and an unversioned budget export import the same way", func(t *testing.T) {
		h, fake, _ := exportSetup(t)
		for _, body := range []string{part, `{"expenses":[],"tags":[]}`} {
			rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import", body)
			if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"imported"`) {
				t.Fatalf("body %s: status = %d, response %s", body, rec.Code, rec.Body)
			}
		}
		if len(fake.imports) != 2 {
			t.Errorf("imports = %d", len(fake.imports))
		}
	})

	t.Run("a refused or broken part is reported failed with a 200 overall", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		for body, reason := range map[string]string{
			bundle(`{"format":"coregateway.budget","version":1,"data":"refuse"}`):  "date is not a date",
			bundle(`{"format":"coregateway.budget","version":1,"data":"explode"}`): "database unreachable",
		} {
			rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import", body)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d", rec.Code)
			}
			var got export.ImportResponse
			mustDecode(t, rec.Body.Bytes(), &got)
			res := string(got.Parts["budget"])
			if !strings.Contains(res, `"status":"failed"`) || !strings.Contains(res, reason) {
				t.Errorf("budget result = %s, want failed with %q", res, reason)
			}
		}
	})

	t.Run("a part this gateway doesn't know is skipped", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		body := `{"format":"coregateway.export","version":1,"parts":{"budget":` + part + `,"garden":{}}}`
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import", body)
		var got export.ImportResponse
		mustDecode(t, rec.Body.Bytes(), &got)
		if !strings.Contains(string(got.Parts["garden"]), `"status":"skipped"`) {
			t.Errorf("garden = %s", got.Parts["garden"])
		}
	})

	t.Run("a part the key can't write is reported skipped", func(t *testing.T) {
		h, fake, _ := exportSetup(t)
		body := `{"format":"coregateway.export","version":1,"parts":{"budget":` + part + `,"kanban":{"format":"coregateway.kanban","version":1,"data":{}}}}`
		rec := doKeyRequest(t, h, testCorebanWriteKeyPlaintext, http.MethodPost, "/api/import", body)
		var got export.ImportResponse
		mustDecode(t, rec.Body.Bytes(), &got)
		if !strings.Contains(string(got.Parts["budget"]), "corefinance:write") || !strings.Contains(string(got.Parts["kanban"]), `"status":"imported"`) {
			t.Errorf("response = %s", rec.Body)
		}
		if len(fake.imports) != 1 {
			t.Errorf("imports = %d, want kanban only", len(fake.imports))
		}
	})

	t.Run("the account part is export-only", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		account := `{"format":"coregateway.account","version":1,"data":{"id":"` + uuid.NewString() + `","email":"x@example.com","role":"admin","timezone":"UTC"}}`
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import", account)
		var got export.ImportResponse
		mustDecode(t, rec.Body.Bytes(), &got)
		if !strings.Contains(string(got.Parts["account"]), `"status":"skipped"`) {
			t.Errorf("response = %s", rec.Body)
		}
	})

	t.Run("a read-only key can export but not import", func(t *testing.T) {
		h, fake, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testReadKeyPlaintext, http.MethodPost, "/api/import", bundle(part))
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "corefinance:write") {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
		if len(fake.imports) != 0 {
			t.Errorf("downstream imported")
		}
	})

	t.Run("the demo guest can't import", func(t *testing.T) {
		h, fake, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testGuestKeyPlaintext, http.MethodPost, "/api/import", bundle(part))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d", rec.Code)
		}
		if len(fake.imports) != 0 {
			t.Errorf("downstream imported")
		}
	})

	t.Run("files it can't read are 400s", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		for _, body := range []string{
			`not json`,
			`{"hello":"world"}`,
			`{"format":"something.else","version":1}`,
			`{"format":"coregateway.export","version":2,"parts":{"budget":{}}}`,
			`{"format":"coregateway.export","version":1,"parts":{}}`,
		} {
			if rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import", body); rec.Code != http.StatusBadRequest {
				t.Errorf("%s: status = %d, want 400", body, rec.Code)
			}
		}
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import?parts=kanban", bundle(part))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("asking for a part the file lacks: status = %d", rec.Code)
		}
	})

	t.Run("a body over 25 MB is refused", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		big := bundle(`"` + strings.Repeat("x", export.MaxImportBytes) + `"`)
		req := httptest.NewRequest(http.MethodPost, "/api/import", bytes.NewBufferString(big))
		req.Header.Set("Authorization", "Bearer "+testAdminKeyPlaintext)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d", rec.Code)
		}
	})
}

func validate(t *testing.T, file []byte) {
	t.Helper()
	c := jsonschema.NewCompiler()
	c.AssertFormat()
	for name, id := range map[string]string{"export.v1.json": export.Schema, "account.v1.json": export.AccountSchema} {
		raw, err := os.ReadFile("../../schemas/" + name)
		if err != nil {
			t.Fatal(err)
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		if err := c.AddResource(id, doc); err != nil {
			t.Fatal(err)
		}
	}
	schema, err := c.Compile(export.Schema)
	if err != nil {
		t.Fatal(err)
	}
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(file))
	if err != nil {
		t.Fatal(err)
	}
	if err := schema.Validate(inst); err != nil {
		t.Errorf("bundle does not validate: %v\n%s", err, file)
	}
}

func mustZone(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func mustDecode(t *testing.T, b []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatalf("decode %s: %v", b, err)
	}
}
