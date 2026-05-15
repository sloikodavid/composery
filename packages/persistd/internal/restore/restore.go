// Package restore applies the durable persistd state to the live
// filesystem. It is run by the container entrypoint before Supervisor
// starts services, and uses only the SQLite paths table and the object
// store; it does not consult audit cursors or watcher state.
package restore

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"lukechampine.com/blake3"

	"github.com/sloikodavid/agentbox/packages/persistd/internal/config"
	"github.com/sloikodavid/agentbox/packages/persistd/internal/db"
	"github.com/sloikodavid/agentbox/packages/persistd/internal/metadata"
	"github.com/sloikodavid/agentbox/packages/persistd/internal/objectstore"
)

var runtimeProtectedPaths = []string{"/etc/hostname", "/etc/hosts", "/etc/resolv.conf"}

// Run applies persisted state to the live filesystem.
func Run(ctx context.Context, paths config.Paths) error {
	cfg, _, err := config.LoadOrCreate(paths.Config)
	if err != nil {
		return fmt.Errorf("restore: load config: %w", err)
	}
	sqldb, err := db.Open(ctx, paths.DB)
	if err != nil {
		return fmt.Errorf("restore: open db: %w", err)
	}
	defer sqldb.Close()

	store, err := objectstore.Open(paths.Objects)
	if err != nil {
		return fmt.Errorf("restore: open object store: %w", err)
	}

	rows, err := loadRows(ctx, sqldb)
	if err != nil {
		return err
	}
	rows, err = filterRows(rows, append(runtimeProtectedPaths, cfg.Exclude.RootRelative...))
	if err != nil {
		return err
	}

	present, removed := splitByState(rows)
	present = dropPresentDescendantsOfRemoved(present, removed)

	// Apply present entries in parent-before-child order. Path-string
	// length is a sufficient ordering since every parent path is a prefix
	// of its children and thus strictly shorter.
	sort.Slice(present, func(i, j int) bool { return len(present[i].Path) < len(present[j].Path) })
	xattrsByID, err := loadXattrs(ctx, sqldb)
	if err != nil {
		return err
	}
	firstByGroup := map[string]string{}
	for _, r := range present {
		if err := applyPresent(ctx, store, r, firstByGroup); err != nil {
			return fmt.Errorf("restore: %s: %w", r.Path, err)
		}
		if err := metadata.ApplyXattrs(r.Path, xattrsByID[r.ID]); err != nil {
			return fmt.Errorf("restore: xattrs %s: %w", r.Path, err)
		}
	}

	// Apply tombstones in child-before-parent order so directory removals
	// see empty directories.
	sort.Slice(removed, func(i, j int) bool { return len(removed[i].Path) > len(removed[j].Path) })
	for _, r := range removed {
		if err := applyTombstone(r); err != nil {
			return fmt.Errorf("restore: tombstone %s: %w", r.Path, err)
		}
	}
	return nil
}

func loadRows(ctx context.Context, sqldb *sql.DB) ([]db.PathRow, error) {
	rows, err := sqldb.QueryContext(ctx, `
SELECT path_id, path, parent_path_id, basename, state, kind, mode, uid, gid,
       atime_ns, mtime_ns, ctime_seen_ns, size,
       object_algorithm, object_hash, symlink_target,
       special_major, special_minor, hardlink_group_id,
       content_hash_verified_at_ns, last_audited_at_ns, metadata_version
FROM paths`)
	if err != nil {
		return nil, fmt.Errorf("restore: query paths: %w", err)
	}
	defer rows.Close()
	var out []db.PathRow
	for rows.Next() {
		var r db.PathRow
		if err := rows.Scan(
			&r.ID, &r.Path, &r.ParentID, &r.Basename, &r.State, &r.Kind,
			&r.Mode, &r.UID, &r.GID,
			&r.AtimeNs, &r.MtimeNs, &r.CtimeSeenNs, &r.Size,
			&r.ObjectAlgorithm, &r.ObjectHash, &r.SymlinkTarget,
			&r.SpecialMajor, &r.SpecialMinor, &r.HardlinkGroupID,
			&r.ContentHashVerifiedAtNs, &r.LastAuditedAtNs, &r.MetadataVersion,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func filterRows(rows []db.PathRow, excluded []string) ([]db.PathRow, error) {
	out := make([]db.PathRow, 0, len(rows))
	for _, r := range rows {
		if err := validatePath(r.Path); err != nil {
			return nil, fmt.Errorf("restore: invalid path row %q: %w", r.Path, err)
		}
		if excludedPath(excluded, r.Path) {
			continue
		}
		out = append(out, r)
	}
	return out, nil
}

func validatePath(p string) error {
	if !filepath.IsAbs(p) {
		return fmt.Errorf("path is not absolute")
	}
	if filepath.Clean(p) != p {
		return fmt.Errorf("path is not clean")
	}
	if p == string(filepath.Separator) || p == "/" {
		return fmt.Errorf("root path is not restorable")
	}
	return nil
}

func excludedPath(prefixes []string, absPath string) bool {
	for _, p := range prefixes {
		if p == "" {
			continue
		}
		if absPath == p || strings.HasPrefix(absPath, p+"/") {
			return true
		}
	}
	return false
}

func splitByState(rows []db.PathRow) (present, removed []db.PathRow) {
	for _, r := range rows {
		switch r.State {
		case db.StatePresent:
			present = append(present, r)
		case db.StateRemoved:
			removed = append(removed, r)
		}
	}
	return
}

func dropPresentDescendantsOfRemoved(present, removed []db.PathRow) []db.PathRow {
	if len(removed) == 0 || len(present) == 0 {
		return present
	}
	out := present[:0]
	for _, p := range present {
		dropped := false
		for _, r := range removed {
			if isDescendant(r.Path, p.Path) {
				dropped = true
				break
			}
		}
		if !dropped {
			out = append(out, p)
		}
	}
	return out
}

func isDescendant(parent, child string) bool {
	if parent == child || !strings.HasPrefix(child, parent) || len(child) == len(parent) {
		return false
	}
	next := child[len(parent)]
	return next == '/' || next == filepath.Separator
}

func applyPresent(ctx context.Context, store *objectstore.Store, r db.PathRow, firstByGroup map[string]string) error {
	switch r.Kind {
	case db.KindDir:
		if err := ensureDirectory(r.Path); err != nil {
			return err
		}
	case db.KindFile:
		if r.ObjectAlgorithm == nil || r.ObjectHash == nil {
			return fmt.Errorf("file row missing object reference")
		}
		if err := ensureParent(r.Path); err != nil {
			return err
		}
		objPath, err := store.Path(*r.ObjectAlgorithm, *r.ObjectHash)
		if err != nil {
			return err
		}
		if r.HardlinkGroupID != nil {
			if peer, ok := firstByGroup[*r.HardlinkGroupID]; ok {
				if err := verifyObjectFile(objPath, *r.ObjectHash, r.Size); err != nil {
					return err
				}
				_ = removeExisting(r.Path)
				if err := os.Link(peer, r.Path); err == nil {
					return applyMetadata(r)
				}
				// Fall through to copy on link failure (cross-device, etc).
			}
		}
		if err := copyObjectFile(objPath, r.Path, *r.ObjectHash, r.Size); err != nil {
			return err
		}
		if r.HardlinkGroupID != nil {
			firstByGroup[*r.HardlinkGroupID] = r.Path
		}
	case db.KindSymlink:
		if r.SymlinkTarget == nil {
			return fmt.Errorf("symlink row missing target")
		}
		if err := ensureParent(r.Path); err != nil {
			return err
		}
		if err := removeExisting(r.Path); err != nil {
			return err
		}
		if err := os.Symlink(*r.SymlinkTarget, r.Path); err != nil {
			return err
		}
	case db.KindFIFO:
		if err := ensureParent(r.Path); err != nil {
			return err
		}
		if err := removeExisting(r.Path); err != nil {
			return err
		}
		mode := uint32(0o644)
		if r.Mode != nil {
			mode = uint32(*r.Mode)
		}
		if err := metadata.Mkfifo(r.Path, mode); err != nil {
			return err
		}
	case db.KindDevice, db.KindOther:
		// Device nodes require CAP_MKNOD; the runtime may not allow it.
		// Skip without failing so the rest of restore proceeds.
		return nil
	default:
		return fmt.Errorf("unknown kind %q", r.Kind)
	}
	return applyMetadata(r)
}

func loadXattrs(ctx context.Context, sqldb *sql.DB) (map[int64][]metadata.Xattr, error) {
	rows, err := sqldb.QueryContext(ctx, `SELECT path_id, name, value FROM xattrs`)
	if err != nil {
		return nil, fmt.Errorf("restore: load xattrs: %w", err)
	}
	defer rows.Close()
	out := map[int64][]metadata.Xattr{}
	for rows.Next() {
		var (
			pid   int64
			name  string
			value []byte
		)
		if err := rows.Scan(&pid, &name, &value); err != nil {
			return nil, err
		}
		out[pid] = append(out[pid], metadata.Xattr{Name: name, Value: value})
	}
	return out, rows.Err()
}

func applyTombstone(r db.PathRow) error {
	if err := rejectSymlinkAncestors(filepath.Dir(r.Path)); err != nil {
		return err
	}
	if err := os.RemoveAll(r.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func ensureParent(p string) error {
	dir := filepath.Dir(p)
	if err := rejectSymlinkAncestors(dir); err != nil {
		return err
	}
	return os.MkdirAll(dir, 0o755)
}

func ensureDirectory(p string) error {
	if err := ensureParent(p); err != nil {
		return err
	}
	info, err := os.Lstat(p)
	if errors.Is(err, os.ErrNotExist) {
		return os.MkdirAll(p, 0o755)
	}
	if err != nil {
		return err
	}
	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		return nil
	}
	if err := os.RemoveAll(p); err != nil {
		return err
	}
	return os.MkdirAll(p, 0o755)
}

func removeExisting(p string) error {
	if err := os.RemoveAll(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func rejectSymlinkAncestors(p string) error {
	clean := filepath.Clean(p)
	for {
		if clean == "." || clean == string(filepath.Separator) || clean == "/" {
			return nil
		}
		info, err := os.Lstat(clean)
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink ancestor %s is not restorable", clean)
		}
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		next := filepath.Dir(clean)
		if next == clean {
			return nil
		}
		clean = next
	}
}

func verifyObjectFile(src, expectedHash string, expectedSize *int64) error {
	info, err := os.Lstat(src)
	if err != nil {
		return fmt.Errorf("stat object: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("object is not a regular file")
	}
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open object: %w", err)
	}
	defer in.Close()
	h := blake3.New(32, nil)
	written, err := io.Copy(h, in)
	if err != nil {
		return fmt.Errorf("read object: %w", err)
	}
	gotHash := hex.EncodeToString(h.Sum(nil))
	if gotHash != expectedHash {
		return fmt.Errorf("object hash mismatch: expected %s got %s", expectedHash, gotHash)
	}
	if expectedSize != nil && written != *expectedSize {
		return fmt.Errorf("object size mismatch: expected %d got %d", *expectedSize, written)
	}
	return nil
}

func copyObjectFile(src, dst, expectedHash string, expectedSize *int64) error {
	info, err := os.Lstat(src)
	if err != nil {
		return fmt.Errorf("stat object: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("object is not a regular file")
	}
	if err := ensureParent(dst); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open object: %w", err)
	}
	defer in.Close()

	dir := filepath.Dir(dst)
	tmp, err := os.CreateTemp(dir, ".persistd-restore-*")
	if err != nil {
		return fmt.Errorf("create temp live file: %w", err)
	}
	tmpPath := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()

	h := blake3.New(32, nil)
	written, err := io.Copy(io.MultiWriter(tmp, h), in)
	if err != nil {
		_ = tmp.Close()
		return fmt.Errorf("copy: %w", err)
	}
	gotHash := hex.EncodeToString(h.Sum(nil))
	if gotHash != expectedHash {
		_ = tmp.Close()
		return fmt.Errorf("object hash mismatch: expected %s got %s", expectedHash, gotHash)
	}
	if expectedSize != nil && written != *expectedSize {
		_ = tmp.Close()
		return fmt.Errorf("object size mismatch: expected %d got %d", *expectedSize, written)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp live file: %w", err)
	}
	if err := removeExisting(dst); err != nil {
		if overwriteErr := overwriteExistingRegularFile(tmpPath, dst); overwriteErr == nil {
			return nil
		}
		return err
	}
	if err := os.Rename(tmpPath, dst); err != nil {
		if overwriteErr := overwriteExistingRegularFile(tmpPath, dst); overwriteErr == nil {
			return nil
		}
		return fmt.Errorf("install live file: %w", err)
	}
	cleanup = false
	return nil
}

func overwriteExistingRegularFile(src, dst string) error {
	info, err := os.Lstat(dst)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("existing path is not a regular file")
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_TRUNC, 0)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func applyMetadata(r db.PathRow) error {
	if r.Kind != db.KindSymlink {
		if r.Mode != nil {
			if err := os.Chmod(r.Path, os.FileMode(*r.Mode)&os.ModePerm); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
		if r.AtimeNs != nil && r.MtimeNs != nil {
			at := time.Unix(0, *r.AtimeNs)
			mt := time.Unix(0, *r.MtimeNs)
			if err := os.Chtimes(r.Path, at, mt); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	if r.UID != nil && r.GID != nil {
		if err := lchown(r.Path, int(*r.UID), int(*r.GID)); err != nil {
			return err
		}
	}
	return nil
}
