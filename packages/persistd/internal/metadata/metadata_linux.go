//go:build linux

package metadata

import (
	"errors"
	"fmt"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

func capture(path string, info os.FileInfo) (FileMetadata, error) {
	md := FileMetadata{}
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		uid := int64(stat.Uid)
		gid := int64(stat.Gid)
		md.UID = &uid
		md.GID = &gid
		if stat.Nlink > 1 && !info.IsDir() {
			id := fmt.Sprintf("%d:%d", stat.Dev, stat.Ino)
			md.HardlinkGroupID = &id
		}
	}
	xs, err := readXattrs(path)
	if err != nil {
		return md, err
	}
	md.Xattrs = xs
	return md, nil
}

func readXattrs(path string) ([]Xattr, error) {
	size, err := unix.Llistxattr(path, nil)
	if err != nil {
		if errors.Is(err, unix.ENOTSUP) || errors.Is(err, unix.ENODATA) {
			return nil, nil
		}
		return nil, fmt.Errorf("metadata: llistxattr %s: %w", path, err)
	}
	if size == 0 {
		return nil, nil
	}
	buf := make([]byte, size)
	n, err := unix.Llistxattr(path, buf)
	if err != nil {
		return nil, fmt.Errorf("metadata: llistxattr (read) %s: %w", path, err)
	}
	names := splitNullTerminated(buf[:n])
	var out []Xattr
	for _, name := range names {
		valSize, err := unix.Lgetxattr(path, name, nil)
		if err != nil {
			if errors.Is(err, unix.ENODATA) {
				continue
			}
			return nil, fmt.Errorf("metadata: lgetxattr size %s/%s: %w", path, name, err)
		}
		val := make([]byte, valSize)
		read, err := unix.Lgetxattr(path, name, val)
		if err != nil {
			if errors.Is(err, unix.ENODATA) {
				continue
			}
			return nil, fmt.Errorf("metadata: lgetxattr %s/%s: %w", path, name, err)
		}
		out = append(out, Xattr{Name: name, Value: val[:read]})
	}
	return out, nil
}

func applyXattrs(path string, xs []Xattr) error {
	for _, x := range xs {
		if err := unix.Lsetxattr(path, x.Name, x.Value, 0); err != nil {
			// Permission errors on privileged namespaces (e.g. security.*)
			// are non-fatal: the container may not be allowed to write
			// them. Other errors still surface so we don't silently lose
			// user.* xattrs.
			if errors.Is(err, unix.EPERM) || errors.Is(err, unix.ENOTSUP) || errors.Is(err, unix.EOPNOTSUPP) {
				continue
			}
			return fmt.Errorf("metadata: lsetxattr %s/%s: %w", path, x.Name, err)
		}
	}
	return nil
}

func mkfifo(path string, mode uint32) error {
	if err := unix.Mkfifo(path, mode); err != nil {
		if errors.Is(err, unix.EEXIST) {
			return nil
		}
		return fmt.Errorf("metadata: mkfifo %s: %w", path, err)
	}
	return nil
}

func splitNullTerminated(buf []byte) []string {
	var out []string
	start := 0
	for i, b := range buf {
		if b == 0 {
			if i > start {
				out = append(out, string(buf[start:i]))
			}
			start = i + 1
		}
	}
	if start < len(buf) {
		out = append(out, string(buf[start:]))
	}
	return out
}
