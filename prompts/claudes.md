# Running Claude subagents on this machine

How to farm work out to `claude -p` subagents from an orchestrating session, and the
traps that cost real time when they were learned the hard way. Written for this
machine (Windows + Git Bash + PowerShell, CLI 2.1.218).

## Accounts

Three separate plans, selected with `CLAUDE_CONFIG_DIR`. They are config
directories, not separate binaries - there is only ever one `claude.exe`.

```bash
CLAUDE_CONFIG_DIR='C:\Users\sloik\.claude'   # also the interactive default
CLAUDE_CONFIG_DIR='C:\Users\sloik\.claude2'
CLAUDE_CONFIG_DIR='C:\Users\sloik\.claude3'
```

**Quote the path as a single-quoted literal.** Building it inside double quotes with
escaped backslashes - `"C:\\Users\\sloik\\${p}"` - has twice produced a bogus
`Not logged in · Please run /login` for accounts that were fine. If a probe says
every account is logged out, suspect the quoting before believing it.

Probe an account for a few cents before committing a long run to it:

```bash
printf 'hi' | CLAUDE_CONFIG_DIR='C:\Users\sloik\.claude2' claude -p \
  --model claude-haiku-4-5-20251001 --output-format json
```

## Launching

Pin the model **and** the effort explicitly; never rely on the profile default, and
never pass `--fallback-model` (it downgrades silently instead of failing):

```
claude -p --model claude-opus-4-8 --effort xhigh --permission-mode bypassPermissions --output-format json
```

Confirm afterwards from the result JSON's `modelUsage` keys that the intended model
actually ran. A stray `claude-haiku-4-5` entry of a few dozen tokens is the CLI's own
internal utility call, not the agent.

**Deliver the prompt on stdin, never as an argument.** PowerShell 5.1 mangles native
argv at embedded double quotes, which silently truncates a brief at its first quoted
phrase - the agent then works from half a specification and you find out an hour
later. Redirect a file in instead:

```
cmd /c "claude -p ... < brief.md > result.json 2> err.txt"
```

**Detach the process.** Background tasks tracked by the harness get reaped around the
10-15 minute mark, which is shorter than any real agent run. `Start-Process -PassThru`
survives, and `-PassThru` gives the PID you need for monitoring:

```powershell
$p = Start-Process -PassThru -FilePath cmd -ArgumentList "/c claude -p ... < in > out 2> err" `
     -WorkingDirectory "C:\...\worktree" -WindowStyle Hidden
$p.Id | Out-File -Encoding ascii pid.txt
```

**Monitor by PID, not by process name.** Grepping `tasklist` for `claude.exe` matches
the orchestrator's own process, so the watcher can never report a subagent's death and
sits silent forever instead. Watch the specific PID and treat "PID gone with an empty
result file" as a reportable outcome - silence is not success.

## Limits

- The message **"You've hit your monthly spend limit"** is misleading. It has appeared
  on three different accounts within an hour of each other, and each recovered within
  the hour - it is the rolling session/weekly limit surfacing under the wrong text.
  Treat it as "this account is resting", not "this account is finished for the month".
  The honest variant, `"You've hit your session limit · resets <time>"`, names the
  actual reset.
- A limit arrives as `is_error: true` with `api_error_status: 429` in the result JSON,
  and the CLI **flushes that file only on exit** - a result file that reads 0 bytes
  while the process is gone may fill in moments later. Re-read before concluding.
- Budget roughly: an xhigh Opus agent doing real work burns a window in 45-90 turns.
  Sequence agents across accounts rather than running two on one account.
- Work is not lost when a limit hits: the worktree keeps the uncommitted edits and the
  transcript keeps the reasoning. Resume rather than restart (below).

## Resuming

Sessions are per-account, stored at
`<config>/projects/<munged-cwd>/<session-id>.jsonl`. Resume in place with
`claude -p -r <session-id>`, and **copy that file into another account's matching
projects directory** to move a half-finished job to an account that still has budget -
the resumed agent keeps its full context.

When resuming, say what happened ("your run was killed by launcher infrastructure,
your work is still in the worktree, uncommitted") and re-state the finish conditions.
Agents handle this well; they re-read their own diff and carry on.

## Isolation

One git worktree per agent, always. Agents sharing a tree stage each other's files and
redden `main`. Tell every agent to stage explicit paths and never `git add -A`.

```bash
git worktree add -b <branch> ../composery-wt<N> main
```

Worktrees do not carry `packages/ide/upstream` (the submodule) or `node_modules`.
So in a worktree: `tests/code-server-patches.test.ts`, `terminal-sync`, and
`touch-list-focus` fail with `ENOENT` on upstream paths - **not real failures**,
they pass once merged to a tree that has the submodule. `pnpm install --frozen-lockfile`
is fast there (shared store) when an agent needs vitest.

## Writing the brief

- Point at the artifacts that are the specification (`spike/FINDINGS.md`, an existing
  module, a prior commit) instead of re-describing them. Agents read well.
- Give the reasoning behind a constraint, not just the constraint, or it gets
  "simplified" away. The rule that survived was written as _why_ a hardcoded list
  drifts, not "do not hardcode the list".
- State the finish conditions concretely: which gate must pass, what the final report
  must contain, and what to do when it cannot get there. **Give explicit permission to
  land partial work behind a flag** - "a half-working X is worse than an unfinished
  one" produced an honest scaffold instead of a fake completion.
- Repeat the repo's own correctness rules in the brief (falsify each new test, silent
  success is the worst outcome). They are followed when restated, and it is what
  caught a test asserting against its own comments.

## Reviewing what comes back

Read the diff yourself; do not merge on the agent's say-so. Real defects that arrived
inside otherwise excellent work: a gate flipped on before its verification existed,
`if ! cmd; then rc=$?` exiting 0 on failure, and order assertions matching prose in
comments rather than code. Then run the gates in a tree that has the submodule:

```bash
node scripts/cli.mjs   # fmt + clippy -D warnings + Rust suite, in the pinned image
pnpm vitest run        # from the repo root
```

`pnpm check:lint` currently fails repo-wide because of a stale worktree at
`.claude/worktrees/ide-upstream-cleanup-25bb37`; lint the touched paths instead
(`cd packages/web && pnpm exec eslint <paths> --max-warnings 0`) until it is removed.
