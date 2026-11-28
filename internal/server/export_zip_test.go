package server

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/ejsadiarin/coregateway/internal/export"
)

func unzip(t *testing.T, body []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rd, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		out[f.Name], _ = io.ReadAll(rd)
		rd.Close()
	}
	return out
}

// noise is n bytes that don't compress.
func noise(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return string(b)
}

func zipOf(t *testing.T, files map[string]string) string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.WriteString(w, body)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}

func TestExportZip(t *testing.T) {
	t.Run("a full export with media is a zip of the bundle and its files", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?media=true", "")
		if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/zip" {
			t.Fatalf("status = %d, type %q, body %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
		}
		if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, `coregateway-export-`) || !strings.HasSuffix(cd, `.zip"`) {
			t.Errorf("Content-Disposition = %q", cd)
		}
		files := unzip(t, rec.Body.Bytes())
		validate(t, files["export.json"])
		if got := string(files["media/"+fakePhoto]); got != "photo-bytes" {
			t.Errorf("photo = %q", got)
		}
		if got := string(files["media/"+fakeVideo+".poster"]); got != "pst" {
			t.Errorf("poster = %q", got)
		}
		if _, ok := files["media/"+fakeVideo]; ok {
			t.Error("a file its service didn't have is in the zip")
		}
	})

	t.Run("one part with media is that part's file in a zip", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?parts=kanban&media=true", "")
		files := unzip(t, rec.Body.Bytes())
		if !strings.Contains(string(files["export.json"]), `"format":"coregateway.kanban"`) || files["media/"+fakePhoto] == nil {
			t.Fatalf("files = %v", files)
		}
		if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "coregateway-kanban-") {
			t.Errorf("Content-Disposition = %q", cd)
		}
	})

	t.Run("an admin's export of another user leaves out files", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?media=true&user_id=00000000-0000-4000-8000-000000000000", "")
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d", rec.Code)
		}
	})
}

func TestImportZip(t *testing.T) {
	t.Run("the kanban part goes with its files; the others as JSON", func(t *testing.T) {
		h, fake, _ := exportSetup(t)
		exported := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?media=true", "")
		body := exported.Body.String()
		// A stray file the part doesn't name never reaches the service.
		files := unzip(t, exported.Body.Bytes())
		withStray := map[string]string{"media/stray": "x"}
		for k, v := range files {
			withStray[k] = string(v)
		}
		for _, zipped := range []string{body, zipOf(t, withStray)} {
			fake.fields = nil
			rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import?parts=budget,kanban", zipped)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
			}
			if !strings.Contains(rec.Body.String(), `"part":"kanban","status":"imported"`) ||
				!strings.Contains(rec.Body.String(), `"part":"budget"`) {
				t.Fatalf("results = %s", rec.Body)
			}
			if len(fake.fields) != 1 {
				t.Fatalf("multipart imports = %d", len(fake.fields))
			}
			got := fake.fields[0]
			if !strings.Contains(got["part"], "coregateway.kanban") || got["media/"+fakePhoto] != "photo-bytes" ||
				got["media/"+fakeVideo+".poster"] != "pst" || len(got) != 3 {
				t.Errorf("fields = %v", got)
			}
		}
	})

	t.Run("a zip without its export file is a 400", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import", zipOf(t, map[string]string{"media/x": "y"}))
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "export.json") {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
	})

	t.Run("a zip over the cap is a 413", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		limit := export.MaxZipImportBytes
		export.MaxZipImportBytes = 1 << 10
		t.Cleanup(func() { export.MaxZipImportBytes = limit })
		big := zipOf(t, map[string]string{"export.json": "{}", "media/x": noise(8 << 10)})
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import", big)
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
	})

	t.Run("a JSON import is unchanged", func(t *testing.T) {
		h, fake, _ := exportSetup(t)
		exported := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export", "")
		fake.fields = nil
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import", exported.Body.String())
		if rec.Code != http.StatusOK || len(fake.fields) != 0 {
			t.Fatalf("status = %d, multipart = %d, body %s", rec.Code, len(fake.fields), rec.Body)
		}
	})
}
