// Package metadata captures and applies the file-system metadata fields
// persistd preserves beyond the bare path and content hash: ownership,
// timestamps, hardlink group identity, and extended attributes. ACLs and
// Linux capabilities are stored as xattrs and round-trip through this
// package without special handling.
package metadata

import "os"

// Xattr is one extended attribute name-value pair.
type Xattr struct {
	Name  string
	Value []byte
}

// FileMetadata is the bundle audit captures and restore applies. Pointer
// fields are nil when not applicable to the OS or the file type.
type FileMetadata struct {
	UID             *int64
	GID             *int64
	HardlinkGroupID *string
	Xattrs          []Xattr
}

// Capture reads metadata for an already-lstatted path. info is the
// os.FileInfo from the caller's lstat; the implementation may consult
// info.Sys() for platform-specific fields.
func Capture(path string, info os.FileInfo) (FileMetadata, error) {
	return capture(path, info)
}

// ApplyXattrs writes the provided xattr set onto path, replacing any
// existing values for the same names. Unknown-failure xattrs (for example
// security.* set when the container lacks the privilege) are skipped
// rather than failing the whole restore.
func ApplyXattrs(path string, xs []Xattr) error {
	return applyXattrs(path, xs)
}

// Mkfifo creates a FIFO at path with the given mode. Returns nil and
// records ErrUnsupported on platforms where FIFOs are unavailable.
func Mkfifo(path string, mode uint32) error {
	return mkfifo(path, mode)
}
