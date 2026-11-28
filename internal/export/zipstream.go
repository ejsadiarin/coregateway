package export

import (
	"archive/zip"
	"bufio"
	"compress/flate"
	"encoding/binary"
	"errors"
	"fmt"
	"hash"
	"hash/crc32"
	"io"
)

// zipStream reads a zip front to back, entry by entry from its local
// headers, as it arrives: nothing is kept but the entry being read. A
// zip's directory is at its end, which is why Go's own reader needs the
// whole file; this one doesn't use it. An entry's end comes from its
// header's size, from its deflate stream (which marks its own end), or,
// for a stored entry whose size only a data descriptor after it gives,
// from sizes: what export.json says each file is.
type zipStream struct {
	r     *bufio.Reader
	sizes map[string]int64
	cur   *zipEntryReader
}

const (
	sigLocal       = 0x04034b50
	sigCentral     = 0x02014b50
	sigEnd         = 0x06054b50
	sigEnd64       = 0x06064b50
	sigDescriptor  = 0x08074b50
	flagEncrypted  = 0x1
	flagDescriptor = 0x8
	zip64ExtraID   = 0x0001
)

func newZipStream(r *bufio.Reader) *zipStream {
	return &zipStream{r: r, sizes: map[string]int64{}}
}

// Next is the next entry and its contents, or io.EOF at the directory. The
// previous entry is read to its end first. Reading an entry to its end
// checks its CRC.
func (z *zipStream) Next() (string, io.Reader, error) {
	if z.cur != nil {
		if _, err := io.Copy(io.Discard, z.cur); err != nil {
			return "", nil, err
		}
		z.cur = nil
	}
	var sig uint32
	if err := binary.Read(z.r, binary.LittleEndian, &sig); err != nil {
		return "", nil, damaged(err)
	}
	switch sig {
	case sigLocal:
	case sigCentral, sigEnd, sigEnd64:
		return "", nil, io.EOF
	default:
		return "", nil, badFile{"this zip can't be read from start to end"}
	}
	var h struct {
		Version, Flags, Method, Time, Date uint16
		CRC, CompressedSize, Size          uint32
		NameLen, ExtraLen                  uint16
	}
	if err := binary.Read(z.r, binary.LittleEndian, &h); err != nil {
		return "", nil, damaged(err)
	}
	name := make([]byte, h.NameLen)
	extra := make([]byte, h.ExtraLen)
	if _, err := io.ReadFull(z.r, name); err != nil {
		return "", nil, damaged(err)
	}
	if _, err := io.ReadFull(z.r, extra); err != nil {
		return "", nil, damaged(err)
	}
	if h.Flags&flagEncrypted != 0 {
		return "", nil, badFile{"this zip is encrypted"}
	}
	e := &zipEntryReader{name: string(name), crc: crc32.NewIEEE(), wantCRC: h.CRC, wantSize: int64(h.Size)}
	csize, size := int64(h.CompressedSize), int64(h.Size)
	if c, s, ok := zip64Sizes(extra, h.CompressedSize, h.Size); ok {
		csize, size, e.zip64 = c, s, true
		e.wantSize = size
	}
	e.descriptor = h.Flags&flagDescriptor != 0
	known := !e.descriptor || csize > 0 || size > 0

	var raw io.Reader
	switch {
	case known:
		raw = io.LimitReader(z.r, csize)
	case h.Method == zip.Deflate:
		// Deflate marks its own end, and a bufio.Reader is a ByteReader,
		// so flate reads no further than it.
		raw = z.r
	default:
		n, ok := z.sizes[e.name]
		if !ok {
			return "", nil, badFile{fmt.Sprintf("the zip's %s has no size to read it by; export the zip again from the Data page", e.name)}
		}
		raw = io.LimitReader(z.r, n)
	}
	switch h.Method {
	case zip.Store:
		e.body = raw
	case zip.Deflate:
		e.body = flate.NewReader(raw)
		if known {
			e.rest = raw // what flate left of its known size
		}
	default:
		return "", nil, badFile{fmt.Sprintf("the zip's %s uses a compression the gateway can't read", e.name)}
	}
	e.finish = func() error { return z.finish(e) }
	z.cur = e
	return e.name, e, nil
}

// finish reads what follows an entry's data and checks its CRC and size.
func (z *zipStream) finish(e *zipEntryReader) error {
	if e.rest != nil {
		if _, err := io.Copy(io.Discard, e.rest); err != nil {
			return damaged(err)
		}
	}
	if e.descriptor {
		peek, err := z.r.Peek(4)
		if err != nil {
			return damaged(err)
		}
		if binary.LittleEndian.Uint32(peek) == sigDescriptor {
			_, _ = z.r.Discard(4)
		}
		var crc uint32
		if err := binary.Read(z.r, binary.LittleEndian, &crc); err != nil {
			return damaged(err)
		}
		e.wantCRC = crc
		if e.zip64 {
			var sizes [2]uint64
			if err := binary.Read(z.r, binary.LittleEndian, &sizes); err != nil {
				return damaged(err)
			}
			e.wantSize = int64(sizes[1])
		} else {
			var sizes [2]uint32
			if err := binary.Read(z.r, binary.LittleEndian, &sizes); err != nil {
				return damaged(err)
			}
			e.wantSize = int64(sizes[1])
		}
	}
	if e.crc.Sum32() != e.wantCRC || e.n != e.wantSize {
		return badFile{fmt.Sprintf("the zip's %s is damaged", e.name)}
	}
	return nil
}

// zip64Sizes reads an entry's sizes from its zip64 extra field, present
// when a header's 32-bit size is 0xFFFFFFFF.
func zip64Sizes(extra []byte, csize, size uint32) (int64, int64, bool) {
	for len(extra) >= 4 {
		id := binary.LittleEndian.Uint16(extra)
		n := int(binary.LittleEndian.Uint16(extra[2:]))
		if len(extra) < 4+n {
			break
		}
		field := extra[4 : 4+n]
		extra = extra[4+n:]
		if id != zip64ExtraID {
			continue
		}
		c, s := int64(csize), int64(size)
		if size == 0xFFFFFFFF && len(field) >= 8 {
			s, field = int64(binary.LittleEndian.Uint64(field)), field[8:]
		}
		if csize == 0xFFFFFFFF && len(field) >= 8 {
			c = int64(binary.LittleEndian.Uint64(field))
		}
		return c, s, true
	}
	return int64(csize), int64(size), false
}

// zipEntryReader is one entry's contents, checked once read to its end.
type zipEntryReader struct {
	name       string
	body       io.Reader
	rest       io.Reader // a deflated entry's raw data, drained after it
	descriptor bool
	zip64      bool
	crc        hash.Hash32
	n          int64
	wantCRC    uint32
	wantSize   int64
	finish     func() error
	done       bool
	err        error
}

func (e *zipEntryReader) Read(p []byte) (int, error) {
	if e.done {
		return 0, e.err
	}
	n, err := e.body.Read(p)
	e.n += int64(n)
	e.crc.Write(p[:n])
	if errors.Is(err, io.EOF) {
		e.done = true
		e.err = io.EOF
		if ferr := e.finish(); ferr != nil {
			e.err = ferr
		}
		return n, e.err
	}
	if err != nil {
		e.done, e.err = true, damaged(err)
		return n, e.err
	}
	return n, nil
}

// damaged is a zip that ends or breaks off in the middle of an entry.
func damaged(err error) error {
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return badFile{"the zip ends in the middle of a file; it may be incomplete"}
	}
	return err
}
