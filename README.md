# Speusis Downloader React v0.1.1 — Xuro-shell rebuild

## What this is

The same Speusis Downloader engine, wearing a new UI built on Xuro's real
design system (colors, spacing, motion, the two-pane Settings layout, the
shared dialog chrome) instead of the original vanilla HTML/CSS renderer.

## Architecture

```
speusis/
├─ speusis-core/     <- UNCHANGED. Original download engine: HTTP, FTP,
│                       BitTorrent (librqbit), archive handling, RSS,
│                       licensing, scheduler. Not touched.
├─ src-tauri/         <- UNCHANGED except two version-number edits and
│                       tauri.conf.json's build commands. Same commands.rs,
│                       same state.rs, same main.rs, same 50+ #[tauri::command]
│                       entry points, same event-bus.
├─ browser-extension/ <- UNCHANGED. Companion extension (Chrome/Firefox/
│                       Edge/Brave/Arc/Chromium) that sends links to the
│                       app over its local listener port. Independent of
│                       the UI rebuild, so it didn't need any changes.
├─ languages/          <- UNCHANGED. ~20 translation JSON files from the
│                       original app. Copied over as data, but the new
│                       React UI doesn't read them yet — every string is
│                       hardcoded English right now. Wiring up a language
│                       switcher against these is a separate follow-up.
└─ frontend/          <- NEW. React + Vite + Tailwind v4, built on Xuro's
                          actual design tokens. Talks to the untouched
                          backend above through the exact same commands
                          and the exact same "event-bus" Tauri event the
                          old vanilla renderer used.
```

## Deliberately left out

- **`signing-keys/`** — contained a **private key** for signing the
  browser extension. Never belongs in a git repo, public or private.
  Nothing in `browser-extension/` reads from that folder at build time
  (checked), so leaving it out doesn't break anything — you just need to
  supply your own signing key at release time, the same as before.
- **old `dist/`** — the pre-built vanilla frontend. Superseded by
  `frontend/`, which builds its own.
- **root `src/downloadManagerBridge.js`** — the old renderer's JS bridge
  to the backend. Superseded by `frontend/src/lib/ipc.ts`, which talks to
  the same commands directly.
- **`android-chrome-512x512.png`, `RELEASE.md`** — a web/PWA icon and old
  changelog, neither used by the desktop app itself. Say the word if you
  want them back in for completeness.


The download engine was never rewritten. Only the window dressing around
it changed — which is what makes "looks like Xuro, behaves like Speusis"
possible without gambling on an AI rewrite of a BitTorrent/HTTP/FTP engine.

## What's real vs. what's a known gap

**Real and wired to actual commands:** every download action (add, batch
add, pause/resume/cancel/remove, open file/folder/with, preview), torrent
file selection, torrent creation, web grabber, RSS feeds, site logins,
license activation, all Settings fields (general/downloads/connections/
schedule/appearance/about), segment map, properties, delete. The
throughput graph is driven by real `receivedBytes` deltas and real
`DownloadProgress` events, not fake numbers.

**One honest gap:** the "Move/rename" dialog exists in the UI (matching
the original's panel list) but has no backend command to call — the
current engine doesn't expose one. Rather than invent one and risk
silently changing engine behavior, the dialog says so and disables Save.
Search `commands.rs` for a rename/move command if you want to wire this
up for real — the UI is ready for it. The row menu's "Tracer" entry has
the same situation — shown, grayed out, no backend command exists for it.

**Small deliberate improvement over 1:1 parity:** the original's
"Redownload"/"Refresh address" actions only removed the old row from the
renderer's local state, leaving the stale task sitting in the backend
forever. This version also calls `download_remove` on the old task so the
backend's list doesn't accumulate orphaned entries — same visible
behavior, cleaner state underneath.

**Not carried over (out of scope for this pass):** the old Web Grabber
had a filter-by-extension input and Select All/None buttons alongside the
scanned link list. Noting it here in case you want it in a future pass —
straightforward to add, just wasn't part of this round's fix list.

**Native panel windows:** the original app mostly shows its dialogs as
in-page overlays (see the old `app.js`'s `isNativePanelWindow` flag,
which defaults to false) — that's what this rebuild does too, by default.
The handful of cases where the backend spawns a *separate* OS window via
`panel_open` (e.g. the Basket) are still wired that way.

## Building

Everything here is real source, not a binary build — this sandbox has no
Rust toolchain, so the backend (which is unmodified anyway) couldn't be
compiled here. What *was* verified in this environment:

- `npm run build` in `frontend/` — clean, zero TypeScript errors, zero
  console errors when smoke-tested against a mocked Tauri backend.
- Every dialog and the main shell were rendered and screenshotted against
  realistic mock data to confirm the real components — not a static
  mockup — produce the approved design.

To build for real, from `speusis/`:

```sh
cd frontend && npm install
cd ../src-tauri && cargo tauri build
```

(`beforeBuildCommand` in `tauri.conf.json` already runs the frontend build
for you if you use `cargo tauri build` from `src-tauri/`.)

## Version

**0.1.1** — a UI/polish pass on top of 0.1.0: accent-aware graph and progress
bar colors (no more hardcoded blue/green), collapsible + hover-scrollbar
sidebar sections, richer About/Help/Registration content pulled from the
original app's real strings, a redesigned Basket with real HTML5 drag-drop,
and a fuller row-action menu (Extract/Zip, Redownload, Refresh address, Copy
URL, etc.) with Xuro's exact dropdown motion. Bumped across
`frontend/package.json`, `src-tauri/Cargo.toml`, and `tauri.conf.json`.
`speusis-core`'s own crate version (0.4.6) was left alone since it's
unmodified library code.
