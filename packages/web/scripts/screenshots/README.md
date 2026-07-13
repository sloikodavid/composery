# Marketing screenshots

Generates the product shots in
[`../../public/marketing/`](../../public/marketing) - used by the homepage and
the repo README. Each is captured from a real, running Composery instance, then
framed in a faithful **macOS Safari** (desktop) or **iPhone 17 Pro** (mobile)
window and written out in a light and a dark UI variant.

```
composery-ide-{dark,light}.png       hero: morning brief + Claude Code working
composery-mobile-{dark,light}.png    phone trio: welcome, agent, a document
composery-welcome-{dark,light}.png   the branded welcome / agent picker
composery-editor-{dark,light}.png    a real automation open in the editor
```

## How it works

1. **Capture** ([`capture-desktop.mjs`](capture-desktop.mjs),
   [`capture-mobile.mjs`](capture-mobile.mjs)) drive the instance with Playwright
   and screenshot the raw workbench into `raw/<theme>/`.
2. **Frame** ([`frame.py`](frame.py)) wraps each capture in a device window. The
   chrome is drawn from Apple's own screenshots and specs - real SF Pro text,
   real SF Symbols glyphs, iPhone 17 Pro geometry (434x906 pt body, 62 pt
   continuous display corners, Dynamic Island), continuous (squircle) corners.
3. **Finalize** ([`finalize.py`](finalize.py)) builds the phone trios and copies
   the eight named assets into `../../public/marketing/`.

`raw/`, `out/` and `fonts/` are gitignored; only the final PNGs are committed.

Paths are resolved relative to this folder, so the commands below work from any
directory. They assume the Composery IDE is on `http://localhost:8080` (override
with `COMPOSERY_URL`).

## One-time setup

- **Fonts.** `bash fonts.sh` fetches SF Pro + SF Symbols from Apple into `fonts/`
  (Apple-licensed, so never committed). Needs 7-Zip.
- **Python.** `pip install Pillow`.
- **Playwright** browsers come with the repo's dev deps (`pnpm install`).
- **A demo instance** on `:8080` with a fresh volume (stop `pnpm dev:docker`
  first if it holds the port):
  ```bash
  docker run -d --name composery-shots -p 8080:8080 \
    -v composery_shots_data:/data composery-composery:latest
  ```
  Open http://localhost:8080, register the password (`example123`, or set
  `COMPOSERY_PASSWORD`), then, from this folder:
  ```bash
  export MSYS_NO_PATHCONV=1   # git-bash only
  docker cp demo/workspace.sh composery-shots:/tmp/workspace.sh
  docker exec -u user composery-shots bash /tmp/workspace.sh
  docker cp demo/prepare.sh composery-shots:/tmp/prepare.sh
  docker exec -u user composery-shots bash /tmp/prepare.sh
  ```
- **Claude Code.** Install and authenticate it inside the instance (run `claude`
  in a terminal and sign in). The shots use Fable 5.

## Regenerate

```bash
bash run.sh                        # all four devices x themes, then frame + finalize
```

Or a single frame while iterating on the framing:

```bash
node capture-desktop.mjs dark
python frame.py && python finalize.py
```

## What is capture-only vs shipped

The [`demo/`](demo) scripts shape a throwaway instance and **do not ship**: they
force the terminal's DOM renderer (a headless-capture DPI quirk), default Claude
to Fable 5, keep it in the terminal rather than the editor, and hide VS Code's
own onboarding walkthroughs.

Fixes found while shooting that _are_ real product improvements live in the repo
proper, not here: the terminal `lineHeight` that was clipping TUI block art
(`rootfs/.../settings.json`) and the narrow-viewport title-bar logo and Welcome
spacing (`packages/ide/overlay/.../narrow.css`).
