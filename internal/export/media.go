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
	"strings"
	"time"

	"github.com/ejsadiarin/coregateway/internal/helper"
)

const (
	// zipEntry is the export file inside a zip; its parts' files sit
	// beside it under media/.
	zipEntry = "export.json"

	// transferTime is how long a zip export or import may take, past the
	// server's own read and write timeouts.
	transferTime = 12 * time.Hour
)

var zipSignature = []byte("PK\x03\x04")

// badFile is an import the gateway can't read: a 400.
type badFile struct{ msg string }

func (b badFile) Error() string { return b.msg }

// mediaFile is a file a part refers to. Name is what its service calls it
// ("<id>", or "<id>.poster"); File is its name under media/ in a zip, with
// the extension of its type ("<id>.webp", "<id>.poster.webp"), so it opens
// from the zip; Size is its size as the part gives it.
type mediaFile struct {
	Name, File string
	Size       int64
}

// zipNames is the names a file may have in a zip: with its extension, and
// without, as zips were written before files had one.
func (f mediaFile) zipNames() []string {
	if f.File == f.Name {
		return []string{f.Name}
	}
	return []string{f.File, f.Name}
}

// extensions is the extension of each type the Feed stores: photos as WebP
// (or GIF), videos as MP4, WebM or QuickTime, posters as WebP.
var extensions = map[string]string{
	"image/webp": ".webp", "image/gif": ".gif",
	"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
}

// kanbanFiles lists the kanban part's attachment files: each attachment's
// file, and a video's poster.
func kanbanFiles(part json.RawMessage) ([]mediaFile, error) {
	var p struct {
		Data struct {
			Notes []struct {
				Attachments []struct {
					ID          string `json:"id"`
					ContentType string `json:"content_type"`
					SizeBytes   int64  `json:"size_bytes"`
					PosterBytes *int64 `json:"poster_bytes"`
				} `json:"attachments"`
			} `json:"notes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(part, &p); err != nil {
		return nil, err
	}
	var files []mediaFile
	for _, n := range p.Data.Notes {
		for _, a := range n.Attachments {
			files = append(files, mediaFile{Name: a.ID, File: a.ID + extensions[a.ContentType], Size: a.SizeBytes})
			if a.PosterBytes != nil {
				files = append(files, mediaFile{Name: a.ID + ".poster", File: a.ID + ".poster.webp", Size: *a.PosterBytes})
			}
		}
	}
	return files, nil
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
		for _, f := range names {
			n := f.File
			id, poster := strings.CutSuffix(f.Name, ".poster")
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

// importZip imports a zip as it arrives, reading it front to back. Its
// first entry must be export.json, the export file: each chosen part
// imports from it as from a JSON file, except a part with files, which
// streams to its service as multipart with each file it names as the zip
// reaches it. Nothing is written to disk. The rest of the request is read
// before answering, so the client always gets the answer.
func (h *Handler) importZip(w http.ResponseWriter, r *http.Request, body *bufio.Reader) {
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(transferTime))
	_ = rc.SetWriteDeadline(time.Now().Add(transferTime))
	defer func() { _, _ = io.Copy(io.Discard, body) }()

	z := newZipStream(body)
	name, entry, err := z.Next()
	if err == nil && name != zipEntry {
		err = badFile{"export.json must be the zip's first file; export the zip again from the Data page"}
	}
	var raw []byte
	if err == nil {
		raw, err = io.ReadAll(io.LimitReader(entry, MaxImportBytes+1))
		if err == nil && len(raw) > MaxImportBytes {
			err = badFile{"the zip's export.json is larger than 25 MB"}
		}
	}
	if err != nil {
		h.refuse(w, err)
		return
	}
	h.importFile(w, r, raw, z)
}

// subStream imports a part with its files: the part, then each file it
// names, streamed from the zip into the request as the zip arrives. A
// problem reading the zip fails the part, saying what it was.
func (h *Handler) subStream(r *http.Request, p Part, query url.Values, part json.RawMessage, z *zipStream) json.RawMessage {
	files, err := p.Files(part)
	if err != nil {
		files = nil // the service reports a part it can't read
	}
	// Each file by its names in the zip, to the name its service takes.
	named := map[string]string{}
	for _, f := range files {
		for _, n := range f.zipNames() {
			named[n] = f.Name
			// A stored entry may give its size only after its data.
			z.sizes["media/"+n] = f.Size
		}
	}
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	done := make(chan error, 1)
	go func() {
		err := writeStream(mw, part, named, z)
		pw.CloseWithError(err)
		done <- err
	}()
	rec := httptest.NewRecorder()
	h.serve(rec, r, http.MethodPost, p.ImportPath, query, pr, mw.FormDataContentType())
	pr.CloseWithError(errors.New("the part's import has answered"))
	var bad badFile
	if zipErr := <-done; errors.As(zipErr, &bad) {
		return mustJSON(PartResult{Part: p.Name, Format: p.Format, DryRun: query.Get("dry_run") == "true", Status: StatusFailed,
			Errors: []PartError{{Entity: "part", Reason: bad.Error()}}})
	}
	return partResult(p, query.Get("dry_run") == "true", rec)
}

func writeStream(mw *multipart.Writer, part json.RawMessage, named map[string]string, z *zipStream) error {
	f, err := mw.CreateFormField("part")
	if err != nil {
		return err
	}
	if _, err := f.Write(part); err != nil {
		return err
	}
	for {
		name, entry, err := z.Next()
		if errors.Is(err, io.EOF) {
			return mw.Close()
		}
		if err != nil {
			return err
		}
		n, inMedia := strings.CutPrefix(name, "media/")
		target, ok := named[n]
		if !inMedia || !ok {
			continue // Next reads past it
		}
		w, err := mw.CreateFormFile("media/"+target, n)
		if err != nil {
			return err
		}
		if _, err := io.Copy(w, entry); err != nil {
			return err
		}
	}
}
