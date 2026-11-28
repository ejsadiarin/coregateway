package export

import (
	"archive/zip"
	"bufio"
	"bytes"
	"compress/flate"
	"errors"
	"hash/crc32"
	"io"
	"testing"
)

type entry struct {
	name, body string
	method     uint16
	sized      bool // sizes in the local header, as Info-ZIP and Python write
}

func build(t *testing.T, entries []entry) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		if !e.sized {
			w, err := zw.CreateHeader(&zip.FileHeader{Name: e.name, Method: e.method})
			if err != nil {
				t.Fatal(err)
			}
			_, _ = io.WriteString(w, e.body)
			continue
		}
		data := []byte(e.body)
		if e.method == zip.Deflate {
			var c bytes.Buffer
			fw, _ := flate.NewWriter(&c, flate.DefaultCompression)
			_, _ = fw.Write(data)
			_ = fw.Close()
			data = c.Bytes()
		}
		w, err := zw.CreateRaw(&zip.FileHeader{Name: e.name, Method: e.method, CRC32: crc32.ChecksumIEEE([]byte(e.body)),
			CompressedSize64: uint64(len(data)), UncompressedSize64: uint64(len(e.body))})
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(data)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func readAll(t *testing.T, zipped []byte, sizes map[string]int64) (map[string]string, error) {
	t.Helper()
	z := newZipStream(bufio.NewReader(bytes.NewReader(zipped)))
	for k, v := range sizes {
		z.sizes[k] = v
	}
	out := map[string]string{}
	for {
		name, r, err := z.Next()
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return out, err
		}
		b, err := io.ReadAll(r)
		if err != nil {
			return out, err
		}
		out[name] = string(b)
	}
}

// Every way an entry's end is found: its header's size, its deflate
// stream, or (stored, sizes after it) the size the export gives it.
func TestZipStreamReadsEveryKindOfEntry(t *testing.T) {
	photo := string(bytes.Repeat([]byte("pixels"), 500))
	entries := []entry{
		{name: "export.json", body: `{"format":"coregateway.export"}`, method: zip.Deflate},
		{name: "media/a", body: photo, method: zip.Store},
		{name: "media/b", body: photo, method: zip.Deflate},
		{name: "media/c", body: photo, method: zip.Store, sized: true},
		{name: "media/d", body: photo, method: zip.Deflate, sized: true},
	}
	got, err := readAll(t, build(t, entries), map[string]int64{"media/a": int64(len(photo))})
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if got[e.name] != e.body {
			t.Errorf("%s: got %d bytes, want %d", e.name, len(got[e.name]), len(e.body))
		}
	}
}

func TestZipStreamRefuses(t *testing.T) {
	t.Run("a stored entry with no size to go by", func(t *testing.T) {
		_, err := readAll(t, build(t, []entry{{name: "media/a", body: "x", method: zip.Store}}), nil)
		var bad badFile
		if !errors.As(err, &bad) {
			t.Fatalf("err = %v", err)
		}
	})
	t.Run("a damaged entry", func(t *testing.T) {
		zipped := build(t, []entry{{name: "media/a", body: "hello", method: zip.Store, sized: true}})
		zipped[bytes.Index(zipped, []byte("hello"))] = 'j'
		if _, err := readAll(t, zipped, nil); err == nil || err.Error() != "the zip's media/a is damaged" {
			t.Fatalf("err = %v", err)
		}
	})
	t.Run("a cut-off zip", func(t *testing.T) {
		zipped := build(t, []entry{{name: "media/a", body: "hello world", method: zip.Deflate}})
		if _, err := readAll(t, zipped[:40], nil); err == nil {
			t.Fatal("no error")
		}
	})
	t.Run("not a zip", func(t *testing.T) {
		if _, err := readAll(t, []byte("not a zip at all"), nil); err == nil {
			t.Fatal("no error")
		}
	})
}
