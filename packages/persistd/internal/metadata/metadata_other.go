//go:build !linux

package metadata

import (
	"errors"
	"os"
)

// ErrUnsupported is returned by metadata helpers on non-Linux builds.
var ErrUnsupported = errors.New("metadata: linux-only operation")

func capture(_ string, _ os.FileInfo) (FileMetadata, error) {
	return FileMetadata{}, nil
}

func applyXattrs(_ string, _ []Xattr) error { return nil }

func mkfifo(_ string, _ uint32) error { return ErrUnsupported }
