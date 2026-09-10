# Releases

All versions of the Xuro-shell rebuild. `speusis-core` (the real download
engine) stays untouched across every one of these except the single
`update_checker.rs` line noted at v0.1.2 — every release below is UI/
frontend work on top of the same unmodified backend, plus the specific
real bugs called out per version.

## v0.1.6

- **Basket rebuilt as a real in-page dialog** — every prior version kept
  it as a separate floating OS window; this was the actual root
  complaint the whole time, not the styling within that window. Now
  uses the same `Modal`/`DialogHeader` chrome as Settings and every
  other dialog. Removed the old separate `basket.html` window entirely.
- **Found and fixed a real, long-standing bug**: basket had been
  listening for an event named `"BasketUrlDropped"` that the backend
  never actually emits — it's defined in the Rust `AppEvent` enum but
  never constructed anywhere. So clipboard-based capture never worked
  in any prior version.
- **Built the actual missing feature**: a clipboard-detection banner in
  the main window (`ClipboardBanner.tsx`), wired to the real
  `"clipboard-url-detected"` event the backend's clipboard watcher
  emits. This is what clipboard detection actually drives in the old
  app — basket itself is drag-drop only.
- **Segment map**: falls back to the currently-running download when
  nothing is explicitly selected, matching the reference design, instead
  of always requiring an explicit click first.
- **About un-shared**: a past version incorrectly merged the toolbar
  header's About dialog with Settings -> About into one component. Split
  back into two — header About stays simple, Settings -> About keeps the
  richer Xuro-style content.
- **Grabber**: added the filter-by-extension/keyword input and Select
  All/None buttons the old app had, which were missing entirely.
- **Batch**: old app's real "Batch" panel scanned the browser's active
  tab via the extension bridge, which isn't practically reproducible
  without that live connection. Kept the paste-based entry (a genuinely
  useful substitute) but added the same filter + Select All/None
  interaction the old panel had, applied to the pasted list.
- **RSS**: added the filter field, interval picker (5min-24h, matching
  the old app's real options), and Auto-download toggle to the add-feed
  form — all missing before.

## v0.1.5

- Basket: fixed the real root cause of it looking wrong — it's a
  separate window/document that never synced theme or accent, so it was
  permanently stuck in light mode. Extracted a shared `applyTheme()`
  helper. Added extension badges, timestamps, retry, clear-log.
- Number input spinners replaced with custom stepper buttons matching
  the app's own tokens instead of mismatched browser defaults.
- Segment map rebuilt to match a provided reference design (checkmarks,
  pulsing active segment, 2x2 stats grid, quick-pick segment-count
  buttons).
- Settings -> About expanded to match Xuro's real structure (this is
  where the About-merging mistake, fixed in 0.1.6, was introduced).

## v0.1.4

- Basket rebuilt to match the old app's real instant-add-on-drop
  behavior (a past version had built a select-then-add staging list
  instead).
- Row-menu/context-menu gating fixed against the old app's real
  `disabled()` function: Open/folder work during active downloads, Play
  works while streaming, Resume covers failed/cancelled, "Add to zip"
  works on any completed file.
- Update flow now adds the installer as a real in-app download instead
  of just opening a browser tab.
- Settings: fixed numeric fields firing a backend call on every
  keystroke. Added the old app's real informational note under
  Downloads.
- About dialog rebuilt to match Xuro's structure.
- Windows installer now uses the app's real icon
  (`nsis.installerIcon`/`uninstallerIcon` were missing from
  `tauri.conf.json` entirely).

## v0.1.3

- Accent colors: 3 of 6 were silently broken — invented names
  (`amber`/`violet`/`rose`) that don't exist in the backend's real
  `AccentColor` enum. Fixed, and added the missing 7th option (`teal`).
- Language switching: built in 0.1.2 but never actually applied to any
  component — fixed to genuinely translate Sidebar/Toolbar/Settings tabs.
- Language dropdown moved off a native `<select>` onto the same
  `MorphMenu` motion as everything else.
- Security scan badge: wrong field name, missing status, wrong label
  text — fixed.
- Logins dialog was built but completely unreachable — no button
  anywhere opened it. Fixed.
- Settings: added the missing "View map" button next to Segments.
- Segment map dialog rebuilt with real state handling instead of one
  generic message.

## v0.1.2

- Real working search (was a non-functional placeholder button).
- Real update-notification system, including a real backend bug fix:
  `update_checker.rs` was hardcoded to check the wrong GitHub repo
  (`Speusis-Downloader` instead of `Speusis-Downloader-react`) — the one
  deliberate exception to an otherwise untouched engine.
- Real i18n infrastructure (language files loaded, but not yet applied
  anywhere — that gap wasn't caught until 0.1.3).
- Settings reorganized into Security/Advanced/Shortcuts tabs matching
  the old app's real structure, plus missing fields (`tempDir`,
  browser-extension buttons).

## v0.1.1

- Fixed the throughput graph's width (was capped at 340px).
- Fixed the Folder button (was calling the wrong backend command).
- Xuro's real "morph" popover motion ported for the row-actions menu.
- Real right-click context menu (previously only the "..." button
  worked).
- Collapsible + hover-scrollbar sidebar sections, `⌘\` toggle.

## v0.1.0

First release of the Xuro-shell rebuild: new React/Vite/Tailwind
frontend built on Xuro's real design tokens, talking to the untouched
`speusis-core` engine and `src-tauri` backend through the same commands
and event-bus the original vanilla renderer used.
