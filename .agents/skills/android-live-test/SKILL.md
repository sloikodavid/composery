---
name: android-live-test
description: Drive Composery Mobile, the Composery IDE, and other Android app or mobile-web interfaces on a physical Android phone or emulator. Use for live UI reproduction, screenshots, taps, typing, swipes, rotation, accessibility inspection, app lifecycle control, logs, screen recording, responsive IDE testing, and fix-and-retest loops.
---

# Android live testing

Use `node .agents/skills/android-live-test/scripts/android.mjs <command>` from the repository root. Run it without arguments for the command list.

## Workflow

1. Run `status`. If no device is connected, run `boot` for the installed emulator. For a physical phone, ask the user to enable Developer options and Wireless debugging, then use `pair` and `connect`; pairing requires values shown on the phone.
2. Start Metro separately with `pnpm --filter mobile dev` — unless it is already running: Metro on 8081 is shared and serves every device, so never start a second one. Open Expo Go with `start host.exp.exponent`, or open a URL/deep link with `open-url <url>`.
3. Run `screenshot tmp/<name>.png`, then inspect the image. Use `dump tmp/<name>.xml` when semantic labels or bounds are useful.
4. Interact with `tap`, `swipe`, `text`, and `key`. Prefer stable visible labels/test IDs through the existing Maestro flows when they cover the scenario; use coordinates for exploration and WebView content.
5. Capture `logcat` around failures. Use `record` for motion, gesture, or timing bugs.
6. Implement the smallest fix, run relevant unit checks, reload/restart the app, and repeat the exact interaction. Preserve before/after screenshots in `tmp/`.

## Surface selection

- Use direct Android control for Composery Mobile, system UI, Expo Go, and the IDE inside the app WebView.
- Use the Codex in-app Browser for the IDE URL when browser DOM inspection, Playwright assertions, or fast responsive viewport coverage is more useful than Android fidelity.
- Test both surfaces for touch, keyboard, viewport inset, fullscreen, clipboard, back navigation, and WebView-only behavior.
- Maestro cannot inspect WebView contents. Do not treat a visible `instance-webview` assertion as proof that IDE actions work.

## Guardrails

- Treat taps that submit, delete, purchase, publish, message, or change real external data as consequential actions and obtain confirmation when required.
- Use a local/test Composery instance and disposable data for destructive flows.
- Do not clear app data, uninstall apps, or reset a physical phone unless the user explicitly requests it.
- Do not commit screenshots, recordings, dumps, or logs; keep them under `tmp/`.
- Never assume a lone device. `status` shows serials; pass `--serial <serial>` (or set `ANDROID_SERIAL`) when multiple devices are attached.
- Parallel agents: one agent per device. `boot` is safe to run concurrently (it picks a free port; the same AVD can run multiple read-only instances) and prints the new serial — pass that serial to every later command. Never send input to a device you did not boot or were not assigned; other devices in `status` may belong to other agents.
