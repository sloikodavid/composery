package storage

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/sloikodavid/agentbox/packages/persistd/internal/config"
)

func TestInit_CreatesDirectories(t *testing.T) {
	root := t.TempDir()
	paths := config.Paths{
		Volume:    root,
		Config:    filepath.Join(root, "persistd", "config.json"),
		DB:        filepath.Join(root, "persistd", "db.sqlite"),
		Objects:   filepath.Join(root, "persistd", "objects"),
		Heartbeat: filepath.Join(root, "run", "persistd", "ready"),
	}
	if err := Init(paths); err != nil {
		t.Fatalf("Init: %v", err)
	}
	for _, want := range []string{
		filepath.Join(root, "persistd"),
		filepath.Join(root, "persistd", "objects", "blake3"),
		filepath.Join(root, "run", "persistd"),
	} {
		info, err := os.Stat(want)
		if err != nil {
			t.Errorf("missing dir %q: %v", want, err)
			continue
		}
		if !info.IsDir() {
			t.Errorf("%q is not a directory", want)
		}
	}
}

func TestInit_IsIdempotent(t *testing.T) {
	root := t.TempDir()
	paths := config.Paths{
		Config:    filepath.Join(root, "persistd", "config.json"),
		DB:        filepath.Join(root, "persistd", "db.sqlite"),
		Objects:   filepath.Join(root, "persistd", "objects"),
		Heartbeat: filepath.Join(root, "run", "persistd", "ready"),
	}
	if err := Init(paths); err != nil {
		t.Fatalf("first Init: %v", err)
	}
	if err := Init(paths); err != nil {
		t.Fatalf("second Init: %v", err)
	}
}
