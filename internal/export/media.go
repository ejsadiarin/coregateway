package export

import (
	"archive/zip"
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/ejsadiarin/coregateway/internal/helper"
)

// MaxZipImportBytes caps an import that is a zip with its files (a var
// only so a test can lower it).
var MaxZipImportBytes int64 = 2 << 30

const (
	// zipEntry is the export file inside a zip; its parts' files sit
	// beside it under media/.
	zipEntry = "export.json"

	// transferTime is how long a zip export or import may take, past the
	// server's own read and write timeouts.
	transferTime = 2 * time.Hour
)

var zipSignature = []byte("PK\x03\x04")

// badFile is an import the gateway can't read: a 400.
type badFile struct{ msg string }

func (b badFile) Error() string { return b.msg }

// kanbanFiles names the kanban part's attachment files: each attachment's
// id, and "<id>.poster" for a video's poster.
func kanbanFiles(part json.RawMessage) ([]string, error) {
	var p struct {
		Data struct {
			Notes []struct {
				Attachments []struct {
					ID          string `json:"id"`
					PosterBytes *int64 `json:"poster_bytes"`
				} `json:"attachments"`
			} `json:"notes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(part, &p); err != nil {
		return nil, err
	}
	var names []string
	for _, n := range p.Data.Notes {
		for _, a := range n.Attachments {
			names = append(names, a.ID)
			if a.PosterBytes != nil {
				names = append(names, a.ID+".poster")
			}
		}
	}
	return names, nil
}

// exportZip writes the export file and every file its parts refer to as a
// zip, each file streamed from its service into the zip as it arrives. A
// file its service can't give is left out, as an import would leave out
// one it can't find; the import then reports it.
func (h *Handler) exportZip(w http.ResponseWriter, r *http.Request, name string, body any, parts []Part, files map[string]json.RawMessage) {
	file, err := json.Marshal(body)
	if err != nil {
		slog.Error("export: encoding the file failed", "error", err)
		helper.RespondErrorJSON(w, http.StatusInternalServerError, "couldn't export your data")
		return
	}
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Now().Add(transferTime))

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.WriteHeader(http.StatusOK)
	zw := zip.NewWriter(w)
	modified := h.now().UTC()
	if err := writeEntry(zw, zipEntry, zip.Deflate, modified, file); err != nil {
		slog.Warn("export: zip write stopped", "error", err)
		return
	}
	for _, p := range parts {
		if p.Files == nil || files[p.Name] == nil {
			continue
		}
		names, err := p.Files(files[p.Name])
		if err != nil {
			slog.Warn("export: listing a part's files failed", "part", p.Name, "error", err)
			continue
		}
		for _, n := range names {
			id, poster := strings.CutSuffix(n, ".poster")
			query := url.Values{}
			if poster {
				query.Set("poster", "true")
			}
			entry := &entryWriter{open: func() (io.Writer, error) {
				// Photos and videos are compressed already.
				return zw.CreateHeader(&zip.FileHeader{Name: "media/" + n, Method: zip.Store, Modified: modified})
			}}
			h.serve(entry, r, http.MethodGet, p.MediaPath+id, query, nil, "")
			if entry.err != nil {
				slog.Warn("export: zip write stopped", "file", n, "error", entry.err)
				return
			}
			if entry.status != http.StatusOK {
				slog.Warn("export: file left out", "part", p.Name, "file", n, "status", entry.status)
			}
		}
	}
	if err := zw.Close(); err != nil {
		slog.Warn("export: zip close failed", "error", err)
	}
}

func writeEntry(zw *zip.Writer, name string, method uint16, modified time.Time, body []byte) error {
	f, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: method, Modified: modified})
	if err != nil {
		return err
	}
	_, err = f.Write(body)
	return err
}

// entryWriter takes a file request's response: a 200's body goes into a
// zip entry opened on its first byte, anything else is dropped.
type entryWriter struct {
	header http.Header
	status int
	open   func() (io.Writer, error)
	w      io.Writer
	err    error
}

func (e *entryWriter) Header() http.Header {
	if e.header == nil {
		e.header = http.Header{}
	}
	return e.header
}

func (e *entryWriter) WriteHeader(code int) {
	if e.status == 0 {
		e.status = code
	}
}

func (e *entryWriter) Write(p []byte) (int, error) {
	if e.status == 0 {
		e.status = http.StatusOK
	}
	if e.status != http.StatusOK {
		return len(p), nil
	}
	if e.err != nil {
		return 0, e.err
	}
	if e.w == nil {
		if e.w, e.err = e.open(); e.err != nil {
			return 0, e.err
		}
	}
	n, err := e.w.Write(p)
	if err != nil {
		e.err = err
	}
	return n, err
}

// zipMedia is an imported zip, kept in a temporary file: its files by
// their names under media/.
type zipMedia struct {
	tmp   *os.File
	files map[string]*zip.File
}

// openZip saves a zip import to a temporary file and reads its export
// file. The files stay in the zip until a part's import streams them.
func openZip(w http.ResponseWriter, r *http.Request, body *bufio.Reader) (*zipMedia, []byte, error) {
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(transferTime))
	_ = rc.SetWriteDeadline(time.Now().Add(transferTime))

	tmp, err := os.CreateTemp("", "coregateway-import-*.zip")
	if err != nil {
		return nil, nil, err
	}
	m := &zipMedia{tmp: tmp, files: map[string]*zip.File{}}
	n, err := io.Copy(tmp, http.MaxBytesReader(w, io.NopCloser(body), MaxZipImportBytes))
	if err != nil {
		return m, nil, err
	}
	zr, err := zip.NewReader(tmp, n)
	if err != nil {
		return m, nil, badFile{"the zip can't be read"}
	}
	var export *zip.File
	for _, f := range zr.File {
		switch {
		case f.Name == zipEntry:
			export = f
		case strings.HasPrefix(f.Name, "media/") && !f.FileInfo().IsDir():
			m.files[strings.TrimPrefix(f.Name, "media/")] = f
		}
	}
	if export == nil {
		return m, nil, badFile{"the zip has no " + zipEntry}
	}
	rd, err := export.Open()
	if err != nil {
		return m, nil, badFile{"the zip's " + zipEntry + " can't be read"}
	}
	defer rd.Close()
	raw, err := io.ReadAll(io.LimitReader(rd, MaxImportBytes+1))
	if err != nil {
		return m, nil, badFile{"the zip's " + zipEntry + " can't be read"}
	}
	if len(raw) > MaxImportBytes {
		return m, nil, badFile{"the zip's " + zipEntry + " is larger than 25 MB"}
	}
	return m, raw, nil
}

func (m *zipMedia) close() {
	m.tmp.Close()
	os.Remove(m.tmp.Name())
}

// has reports whether the zip brings files for p.
func (m *zipMedia) has(p Part) bool {
	return m != nil && p.Files != nil && len(m.files) > 0
}

// subMultipart imports a part with its files: the part, then each file it
// refers to that the zip holds, streamed from the zip into the request.
func (h *Handler) subMultipart(r *http.Request, p Part, query url.Values, part json.RawMessage, m *zipMedia) *httptest.ResponseRecorder {
	names, err := p.Files(part)
	if err != nil {
		names = nil // the service reports a part it can't read
	}
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		pw.CloseWithError(writeMultipart(mw, part, names, m))
	}()
	rec := httptest.NewRecorder()
	h.serve(rec, r, http.MethodPost, p.ImportPath, query, pr, mw.FormDataContentType())
	pr.CloseWithError(errors.New("the part's import has answered"))
	return rec
}

func writeMultipart(mw *multipart.Writer, part json.RawMessage, names []string, m *zipMedia) error {
	f, err := mw.CreateFormField("part")
	if err != nil {
		return err
	}
	if _, err := f.Write(part); err != nil {
		return err
	}
	for _, n := range names {
		zf, ok := m.files[n]
		if !ok {
			continue
		}
		w, err := mw.CreateFormFile("media/"+n, n)
		if err != nil {
			return err
		}
		rd, err := zf.Open()
		if err != nil {
			return err
		}
		_, err = io.Copy(w, rd)
		rd.Close()
		if err != nil {
			return err
		}
	}
	return mw.Close()
}
