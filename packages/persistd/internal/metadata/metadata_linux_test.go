//go:build linux

package metadata

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"syscall"
	"testing"

	"golang.org/x/sys/unix"
)

func TestCaptureAndApplyXattrs_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "f")
	if err := os.WriteFile(path, []byte("body"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := unix.Lsetxattr(path, "user.persistd-test", []byte("value-1"), 0); err != nil {
		if errors.Is(err, unix.ENOTSUP) || errors.Is(err, unix.EOPNOTSUPP) {
			t.Skip("filesystem does not support xattrs")
		}
		t.Fatalf("setxattr seed: %v", err)
	}

	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	md, err := Capture(path, info)
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}

	var found *Xattr
	for i := range md.Xattrs {
		if md.Xattrs[i].Name == "user.persistd-test" {
			found = &md.Xattrs[i]
		}
	}
	if found == nil {
		names := make([]string, 0, len(md.Xattrs))
		for _, x := range md.Xattrs {
			names = append(names, x.Name)
		}
		sort.Strings(names)
		t.Fatalf("xattr not captured; got names=%v", names)
	}
	if !bytes.Equal(found.Value, []byte("value-1")) {
		t.Errorf("captured xattr value = %q", found.Value)
	}

	// Apply onto a fresh file and confirm it appears.
	target := filepath.Join(dir, "g")
	if err := os.WriteFile(target, []byte("body"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ApplyXattrs(target, md.Xattrs); err != nil {
		t.Fatalf("ApplyXattrs: %v", err)
	}
	buf := make([]byte, 64)
	n, err := unix.Lgetxattr(target, "user.persistd-test", buf)
	if err != nil {
		t.Fatalf("lgetxattr after apply: %v", err)
	}
	if !bytes.Equal(buf[:n], []byte("value-1")) {
		t.Errorf("applied xattr value = %q", buf[:n])
	}
}

func TestCapture_HardlinkGroupId(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a")
	b := filepath.Join(dir, "b")
	if err := os.WriteFile(a, []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(a, b); err != nil {
		t.Fatal(err)
	}
	infoA, _ := os.Lstat(a)
	infoB, _ := os.Lstat(b)
	mdA, err := Capture(a, infoA)
	if err != nil {
		t.Fatalf("Capture A: %v", err)
	}
	mdB, err := Capture(b, infoB)
	if err != nil {
		t.Fatalf("Capture B: %v", err)
	}
	if mdA.HardlinkGroupID == nil || mdB.HardlinkGroupID == nil {
		t.Fatalf("expected hardlink group, got A=%v B=%v", mdA.HardlinkGroupID, mdB.HardlinkGroupID)
	}
	if *mdA.HardlinkGroupID != *mdB.HardlinkGroupID {
		t.Errorf("hardlink group mismatch: %q vs %q", *mdA.HardlinkGroupID, *mdB.HardlinkGroupID)
	}
}

func TestCapture_NoHardlinkGroupForSingleLinks(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "solo")
	if err := os.WriteFile(path, []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Lstat(path)
	md, err := Capture(path, info)
	if err != nil {
		t.Fatal(err)
	}
	if md.HardlinkGroupID != nil {
		t.Errorf("single-linked file should not have hardlink group, got %q", *md.HardlinkGroupID)
	}
}

func TestMkfifo_CreatesFIFO(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "pipe")
	if err := Mkfifo(path, 0o644); err != nil {
		t.Fatalf("Mkfifo: %v", err)
	}
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeNamedPipe == 0 {
		t.Errorf("expected FIFO mode, got %v", info.Mode())
	}
}

func TestCapture_UidGid(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "x")
	if err := os.WriteFile(path, []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Lstat(path)
	md, err := Capture(path, info)
	if err != nil {
		t.Fatal(err)
	}
	if md.UID == nil || md.GID == nil {
		t.Fatal("expected uid/gid populated")
	}
	stat := info.Sys().(*syscall.Stat_t)
	if int64(stat.Uid) != *md.UID {
		t.Errorf("uid = %d, want %d", *md.UID, stat.Uid)
	}
}
