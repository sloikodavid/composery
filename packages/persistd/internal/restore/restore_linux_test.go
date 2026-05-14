//go:build linux

package restore

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"golang.org/x/sys/unix"

	"github.com/sloikodavid/agentbox/packages/persistd/internal/config"
	"github.com/sloikodavid/agentbox/packages/persistd/internal/db"
	"github.com/sloikodavid/agentbox/packages/persistd/internal/objectstore"
)

func seedFileWithXattr(t *testing.T, paths config.Paths, livePath string, content []byte, xattrName string, xattrValue []byte) {
	t.Helper()
	ctx := context.Background()
	store, err := objectstore.Open(paths.Objects)
	if err != nil {
		t.Fatalf("objectstore.Open: %v", err)
	}
	tmpSrc := filepath.Join(t.TempDir(), "seed")
	if err := os.WriteFile(tmpSrc, content, 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := store.Capture(ctx, tmpSrc)
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}
	sqldb, err := db.Open(ctx, paths.DB)
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()
	tx, err := sqldb.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.RetainObject(ctx, tx, res.Algorithm, res.Hash, res.Size); err != nil {
		t.Fatal(err)
	}
	mode := int64(0o644)
	saved, err := db.UpsertPath(ctx, tx, db.PathRow{
		Path: livePath, Basename: filepath.Base(livePath), State: db.StatePresent, Kind: db.KindFile,
		Mode: &mode, ObjectAlgorithm: &res.Algorithm, ObjectHash: &res.Hash, MetadataVersion: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO xattrs(path_id, name, value) VALUES (?, ?, ?)`, saved.ID, xattrName, xattrValue); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestRun_RestoresXattrs(t *testing.T) {
	live := t.TempDir()
	paths := setupPaths(t, live)
	target := filepath.Join(live, "x.txt")
	seedFileWithXattr(t, paths, target, []byte("hi"), "user.persistd-test", []byte("ok"))

	if err := Run(context.Background(), paths); err != nil {
		t.Fatalf("Run: %v", err)
	}
	buf := make([]byte, 64)
	n, err := unix.Lgetxattr(target, "user.persistd-test", buf)
	if err != nil {
		if errors.Is(err, unix.ENOTSUP) || errors.Is(err, unix.EOPNOTSUPP) {
			t.Skip("filesystem does not support xattrs")
		}
		t.Fatalf("lgetxattr: %v", err)
	}
	if !bytes.Equal(buf[:n], []byte("ok")) {
		t.Errorf("xattr value = %q", buf[:n])
	}
}

func seedHardlinkGroup(t *testing.T, paths config.Paths, a, b string, content []byte, groupID string) {
	t.Helper()
	ctx := context.Background()
	store, err := objectstore.Open(paths.Objects)
	if err != nil {
		t.Fatal(err)
	}
	tmpSrc := filepath.Join(t.TempDir(), "seed")
	if err := os.WriteFile(tmpSrc, content, 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := store.Capture(ctx, tmpSrc)
	if err != nil {
		t.Fatal(err)
	}
	sqldb, err := db.Open(ctx, paths.DB)
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()
	tx, err := sqldb.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.RetainObject(ctx, tx, res.Algorithm, res.Hash, res.Size); err != nil {
		t.Fatal(err)
	}
	if err := db.RetainObject(ctx, tx, res.Algorithm, res.Hash, res.Size); err != nil {
		t.Fatal(err)
	}
	mode := int64(0o644)
	gid := groupID
	for _, p := range []string{a, b} {
		if _, err := db.UpsertPath(ctx, tx, db.PathRow{
			Path: p, Basename: filepath.Base(p), State: db.StatePresent, Kind: db.KindFile,
			Mode: &mode, ObjectAlgorithm: &res.Algorithm, ObjectHash: &res.Hash,
			HardlinkGroupID: &gid, MetadataVersion: 1,
		}); err != nil {
			t.Fatalf("upsert %s: %v", p, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestRun_RestoresHardlinkAsLink(t *testing.T) {
	live := t.TempDir()
	paths := setupPaths(t, live)
	a := filepath.Join(live, "a")
	b := filepath.Join(live, "b")
	seedHardlinkGroup(t, paths, a, b, []byte("shared"), "42:1234")

	if err := Run(context.Background(), paths); err != nil {
		t.Fatalf("Run: %v", err)
	}
	infoA, err := os.Lstat(a)
	if err != nil {
		t.Fatal(err)
	}
	infoB, err := os.Lstat(b)
	if err != nil {
		t.Fatal(err)
	}
	statA := infoA.Sys().(*syscall.Stat_t)
	statB := infoB.Sys().(*syscall.Stat_t)
	if statA.Ino != statB.Ino {
		t.Errorf("hardlink peers have different inodes: %d vs %d", statA.Ino, statB.Ino)
	}
	if statA.Nlink < 2 {
		t.Errorf("expected Nlink>=2, got %d", statA.Nlink)
	}
}

func TestRun_CreatesFIFO(t *testing.T) {
	live := t.TempDir()
	paths := setupPaths(t, live)
	target := filepath.Join(live, "pipe")
	ctx := context.Background()
	sqldb, err := db.Open(ctx, paths.DB)
	if err != nil {
		t.Fatal(err)
	}
	tx, _ := sqldb.Begin()
	mode := int64(0o644)
	if _, err := db.UpsertPath(ctx, tx, db.PathRow{
		Path: target, Basename: "pipe", State: db.StatePresent, Kind: db.KindFIFO,
		Mode: &mode, MetadataVersion: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	_ = sqldb.Close()

	if err := Run(ctx, paths); err != nil {
		t.Fatalf("Run: %v", err)
	}
	info, err := os.Lstat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeNamedPipe == 0 {
		t.Errorf("expected FIFO, got mode %v", info.Mode())
	}
}
