package gc

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/sloikodavid/agentbox/packages/persistd/internal/db"
	"github.com/sloikodavid/agentbox/packages/persistd/internal/objectstore"
	"github.com/sloikodavid/agentbox/packages/persistd/internal/scheduler"
)

type fixture struct {
	sqldb *sql.DB
	store *objectstore.Store
	root  string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	root := filepath.Join(t.TempDir(), "objects")
	store, err := objectstore.Open(root)
	if err != nil {
		t.Fatalf("objectstore.Open: %v", err)
	}
	sqldb, err := db.Open(context.Background(), filepath.Join(t.TempDir(), "gc.sqlite"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { _ = sqldb.Close() })
	return &fixture{sqldb: sqldb, store: store, root: root}
}

func (f *fixture) captureBytes(t *testing.T, content []byte) (algo, hash string) {
	t.Helper()
	src := filepath.Join(t.TempDir(), "src")
	if err := os.WriteFile(src, content, 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := f.store.Capture(context.Background(), src)
	if err != nil {
		t.Fatal(err)
	}
	return res.Algorithm, res.Hash
}

func (f *fixture) retainRelease(t *testing.T, algo, hash string, content []byte, retainCount int, releases int) {
	t.Helper()
	ctx := context.Background()
	tx, err := f.sqldb.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < retainCount; i++ {
		if err := db.RetainObject(ctx, tx, algo, hash, int64(len(content))); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < releases; i++ {
		if err := db.ReleaseObject(ctx, tx, algo, hash); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func newBudget() *scheduler.Budget {
	return &scheduler.Budget{
		FsOps:     scheduler.NewTokenBucket(1000, 1000, nil),
		HashBytes: scheduler.NewTokenBucket(1e9, 1e9, nil),
	}
}

func runUntilIdle(t *testing.T, c *Collector) int {
	t.Helper()
	ctx := context.Background()
	budget := newBudget()
	calls := 0
	for {
		calls++
		more, err := c.RunOne(ctx, budget)
		if err != nil {
			t.Fatalf("RunOne: %v", err)
		}
		if !more {
			return calls
		}
		if calls > 1000 {
			t.Fatal("gc did not converge")
		}
	}
}

func TestGC_DeletesUnreferencedObject(t *testing.T) {
	f := newFixture(t)
	content := []byte("doomed")
	algo, hash := f.captureBytes(t, content)
	f.retainRelease(t, algo, hash, content, 1, 1)

	storedPath, _ := f.store.Path(algo, hash)
	if _, err := os.Stat(storedPath); err != nil {
		t.Fatalf("object should exist on disk before GC: %v", err)
	}

	c := New(f.sqldb, f.store, Config{})
	runUntilIdle(t, c)

	if _, err := os.Stat(storedPath); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("object file not removed by GC: stat err=%v", err)
	}
	if _, err := db.GetObject(context.Background(), f.sqldb, algo, hash); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("object row not removed: %v", err)
	}
}

func TestGC_PreservesReferencedObject(t *testing.T) {
	f := newFixture(t)
	content := []byte("kept")
	algo, hash := f.captureBytes(t, content)
	f.retainRelease(t, algo, hash, content, 2, 1) // ref_count=1 still

	c := New(f.sqldb, f.store, Config{})
	runUntilIdle(t, c)

	storedPath, _ := f.store.Path(algo, hash)
	if _, err := os.Stat(storedPath); err != nil {
		t.Errorf("live object disappeared: %v", err)
	}
	row, err := db.GetObject(context.Background(), f.sqldb, algo, hash)
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	if row.RefCount != 1 {
		t.Errorf("ref_count = %d, want 1", row.RefCount)
	}
}

func TestGC_RespectsBudget(t *testing.T) {
	f := newFixture(t)
	for i := 0; i < 5; i++ {
		content := []byte{byte('a' + i)}
		algo, hash := f.captureBytes(t, content)
		f.retainRelease(t, algo, hash, content, 1, 1)
	}

	c := New(f.sqldb, f.store, Config{})
	starved := &scheduler.Budget{
		FsOps:     scheduler.NewTokenBucket(0, 0, nil),
		HashBytes: scheduler.NewTokenBucket(1e9, 1e9, nil),
	}
	more, err := c.RunOne(context.Background(), starved)
	if err != nil {
		t.Fatalf("RunOne: %v", err)
	}
	if more {
		t.Error("budget-starved RunOne should yield with more=false")
	}

	backlog, err := c.Backlog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if backlog != 5 {
		t.Errorf("backlog = %d, want 5", backlog)
	}
}

func TestGC_HandlesReplacedFile(t *testing.T) {
	// Simulates a file being replaced: original captured + retained, then
	// released as part of the path moving to a new object.
	f := newFixture(t)
	oldContent := []byte("v1")
	newContent := []byte("v2")
	oldAlgo, oldHash := f.captureBytes(t, oldContent)
	newAlgo, newHash := f.captureBytes(t, newContent)
	f.retainRelease(t, oldAlgo, oldHash, oldContent, 1, 1)
	f.retainRelease(t, newAlgo, newHash, newContent, 1, 0)

	c := New(f.sqldb, f.store, Config{})
	runUntilIdle(t, c)

	oldPath, _ := f.store.Path(oldAlgo, oldHash)
	newPath, _ := f.store.Path(newAlgo, newHash)
	if _, err := os.Stat(oldPath); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("old object should have been GC'd: %v", err)
	}
	if _, err := os.Stat(newPath); err != nil {
		t.Errorf("new object should remain: %v", err)
	}
}
