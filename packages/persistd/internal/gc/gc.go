// Package gc removes object-store files whose SQLite ref_count has
// reached zero. It runs as a low-priority scheduler.Source so that real
// work (dirty paths, audit, verification) preempts it under budget.
package gc

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/sloikodavid/agentbox/packages/persistd/internal/objectstore"
	"github.com/sloikodavid/agentbox/packages/persistd/internal/scheduler"
)

// Collector deletes unreferenced objects. One Collector instance is
// registered with the scheduler at boot.
type Collector struct {
	sqldb    *sql.DB
	store    *objectstore.Store
	priority int
}

// Config tunables; only Priority is currently meaningful.
type Config struct {
	Priority int
}

// New constructs a Collector. priority should be higher (i.e. larger
// integer) than the audit source so GC runs only when faster work is idle.
func New(sqldb *sql.DB, store *objectstore.Store, cfg Config) *Collector {
	if cfg.Priority == 0 {
		cfg.Priority = 1000
	}
	return &Collector{sqldb: sqldb, store: store, priority: cfg.Priority}
}

// Name implements scheduler.Source.
func (c *Collector) Name() string { return "object_gc" }

// Priority implements scheduler.Source.
func (c *Collector) Priority() int { return c.priority }

// RunOne reclaims at most one unreferenced object. The transition is:
// unreferenced -> deleting (DB), delete file, delete row. Returns
// more=true when forward progress was made and more candidates remain.
func (c *Collector) RunOne(ctx context.Context, budget *scheduler.Budget) (bool, error) {
	if !budget.FsOps.TryTake(1) {
		return false, nil
	}
	candidate, err := c.claim(ctx)
	if err != nil {
		return false, err
	}
	if candidate == nil {
		return false, nil
	}
	if err := c.store.Remove(candidate.algorithm, candidate.hash); err != nil {
		// Leave the row in 'deleting' state for retry next pass.
		return false, fmt.Errorf("gc: remove object %s/%s: %w", candidate.algorithm, candidate.hash, err)
	}
	if err := c.finalize(ctx, candidate); err != nil {
		return false, err
	}
	more, err := c.hasMore(ctx)
	if err != nil {
		return false, err
	}
	return more, nil
}

type objectRef struct {
	algorithm string
	hash      string
}

// claim atomically transitions one row from 'unreferenced' to 'deleting'
// and returns its identity. Returns nil candidate when no work remains.
func (c *Collector) claim(ctx context.Context) (*objectRef, error) {
	tx, err := c.sqldb.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	var ref objectRef
	err = tx.QueryRowContext(ctx,
		`SELECT algorithm, hash FROM objects WHERE gc_state='unreferenced' AND ref_count=0 LIMIT 1`,
	).Scan(&ref.algorithm, &ref.hash)
	if errors.Is(err, sql.ErrNoRows) {
		_ = tx.Rollback()
		return nil, nil
	}
	if err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("gc: claim candidate: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE objects SET gc_state='deleting' WHERE algorithm=? AND hash=? AND gc_state='unreferenced' AND ref_count=0`,
		ref.algorithm, ref.hash,
	); err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("gc: transition deleting: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &ref, nil
}

func (c *Collector) finalize(ctx context.Context, ref *objectRef) error {
	_, err := c.sqldb.ExecContext(ctx,
		`DELETE FROM objects WHERE algorithm=? AND hash=? AND gc_state='deleting' AND ref_count=0`,
		ref.algorithm, ref.hash,
	)
	if err != nil {
		return fmt.Errorf("gc: delete row %s/%s: %w", ref.algorithm, ref.hash, err)
	}
	return nil
}

func (c *Collector) hasMore(ctx context.Context) (bool, error) {
	var n int
	err := c.sqldb.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM objects WHERE gc_state='unreferenced' AND ref_count=0`,
	).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// Backlog reports the number of objects waiting for GC, for the heartbeat.
func (c *Collector) Backlog(ctx context.Context) (int, error) {
	var n int
	err := c.sqldb.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM objects WHERE gc_state IN ('unreferenced','deleting')`,
	).Scan(&n)
	return n, err
}
