// Package storage owns the on-disk layout under /data/persistd: the
// SQLite database file and the BLAKE3-addressed object store directory tree.
package storage

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/sloikodavid/agentbox/packages/persistd/internal/config"
)

// ObjectAlgorithm is the fixed hash algorithm used as the object-store
// subdirectory name. It is intentionally not configurable.
const ObjectAlgorithm = "blake3"

// Init ensures every directory required by the persistd storage layout
// exists. The SQLite database file itself is created lazily by the driver
// on first connection.
func Init(paths config.Paths) error {
	persistdDir := filepath.Dir(paths.Config)
	if persistdDir != filepath.Dir(paths.DB) {
		return fmt.Errorf("storage: config and db paths must share a parent directory (config=%q db=%q)", paths.Config, paths.DB)
	}
	for _, dir := range []string{
		persistdDir,
		paths.Objects,
		filepath.Join(paths.Objects, ObjectAlgorithm),
		filepath.Dir(paths.Heartbeat),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("storage: create %s: %w", dir, err)
		}
	}
	return nil
}
