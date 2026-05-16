package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sloikodavid/agentbox/packages/persistd/internal/config"
)

func TestUsageMentionsAllCommands(t *testing.T) {
	for _, cmd := range []string{"restore", "watch", "status", "check"} {
		if !contains(usage, cmd) {
			t.Errorf("usage missing command %q", cmd)
		}
	}
}

func TestWriteWatchFailureWritesDiagnosticPaths(t *testing.T) {
	root := t.TempDir()
	paths := config.Paths{
		Config:    filepath.Join(root, "persistd", "config.json"),
		Heartbeat: filepath.Join(root, "run", "persistd", "ready"),
	}

	writeWatchFailure(paths, errors.New("database is locked"))

	for _, path := range []string{
		watchFailedMarker(paths),
		watchErrorLog(paths),
	} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected %s to exist: %v", path, err)
		}
	}
	if _, err := os.Stat(paths.Heartbeat); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected heartbeat to be removed, got %v", err)
	}
	log, err := os.ReadFile(watchErrorLog(paths))
	if err != nil {
		t.Fatalf("read watch log: %v", err)
	}
	if !strings.Contains(string(log), "database is locked") {
		t.Fatalf("watch log missing error: %s", log)
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
