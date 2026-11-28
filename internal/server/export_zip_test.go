package server

import (
	"archive/zip"
	"bytes"
	"io"
	"maps"
	"net/http"
	"slices"
	"strings"
	"testing"
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

// zipOf zips files as a common tool would (deflated, sizes after each
// entry), export.json first and the rest in name order.
func zipOf(t *testing.T, files map[string]string) string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	names := slices.Sorted(maps.Keys(files))
	slices.SortStableFunc(names, func(a, b string) int {
		return map[bool]int{true: 0, false: 1}[a == "export.json"] - map[bool]int{true: 0, false: 1}[b == "export.json"]
	})
	for _, name := range names {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.WriteString(w, files[name])
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
		// Each file carries its type's extension, so it opens from the zip.
		if got := string(files["media/"+fakePhoto+".webp"]); got != "photo-bytes" {
			t.Errorf("photo = %q", got)
		}
		if got := string(files["media/"+fakeVideo+".poster.webp"]); got != "pst" {
			t.Errorf("poster = %q", got)
		}
		if _, ok := files["media/"+fakeVideo+".mp4"]; ok {
			t.Error("a file its service didn't have is in the zip")
		}
	})

	t.Run("one part with media is that part's file in a zip", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?parts=kanban&media=true", "")
		files := unzip(t, rec.Body.Bytes())
		if !strings.Contains(string(files["export.json"]), `"format":"coregateway.kanban"`) || files["media/"+fakePhoto+".webp"] == nil {
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
		// A zip from before files had extensions names them by id alone.
		legacy := map[string]string{}
		for k, v := range files {
			k = strings.TrimSuffix(strings.TrimSuffix(k, ".webp"), ".mp4")
			legacy[k] = string(v)
		}
		for _, zipped := range []string{body, zipOf(t, withStray), zipOf(t, legacy)} {
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

	t.Run("export.json must come first", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		for _, name := range []string{"media/" + fakePhoto, "export.json"} {
			w, _ := zw.Create(name)
			_, _ = io.WriteString(w, `{"format":"coregateway.kanban","version":1,"data":{}}`)
		}
		_ = zw.Close()
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import", buf.String())
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "first file") {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
	})

	t.Run("a damaged file fails the kanban part", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		zipped := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?media=true", "").Body.Bytes()
		i := bytes.Index(zipped, []byte("photo-bytes"))
		if i < 0 {
			t.Fatal("the photo isn't stored as is")
		}
		zipped[i] = 'X'
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import?parts=kanban", string(zipped))
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"failed"`) ||
			!strings.Contains(rec.Body.String(), "damaged") {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
	})

	t.Run("a cut-off zip fails the kanban part", func(t *testing.T) {
		h, _, _ := exportSetup(t)
		zipped := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodGet, "/api/export?media=true", "").Body.Bytes()
		cut := bytes.Index(zipped, []byte("photo-bytes")) + 3
		rec := doKeyRequest(t, h, testAdminKeyPlaintext, http.MethodPost, "/api/import?parts=kanban", string(zipped[:cut]))
		if !strings.Contains(rec.Body.String(), `"status":"failed"`) || !strings.Contains(rec.Body.String(), "incomplete") {
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
