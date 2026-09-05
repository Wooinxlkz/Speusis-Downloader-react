#!/usr/bin/env node
/**
 * Speusis Downloader Browser Extension — Multi-Browser Build Script v0.19
 *
 * Outputs:
 *   dist/speusis-chromium/   → Chrome, Edge, Opera, Brave, Vivaldi (MV3)
 *   dist/speusis-firefox/    → Firefox 109+ (MV3 with gecko settings)
 *   dist/speusis-chromium.zip
 *   dist/speusis-firefox.zip
 *
 * Safari: load dist/speusis-chromium/ through Xcode's
 *         "Convert to Safari Web Extension" tool (macOS only).
 *
 * Usage:
 *   node build-extension.js
 */

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SRC  = __dirname;
const DIST = path.join(SRC, "dist");

/* Files to copy into every browser build (everything except build script
   and browser-specific manifests) */
const SHARED_FILES = [
  "service-worker.js",
  "content.js",
  "interceptor.js",
  "inject.js",
  "download-dialog.html",
  "download-dialog.js",
  "popup.html",
  "icon16.png",
  "icon48.png",
  "icon128.png",
];

const TARGETS = [
  {
    name:         "speusis-chromium",
    manifestSrc:  "manifest.json",
    label:        "Chromium (Chrome / Edge / Opera / Brave / Vivaldi)",
  },
  {
    name:         "speusis-firefox",
    manifestSrc:  "manifest.firefox.json",
    label:        "Firefox 109+",
  },
];

/* Named per-browser copies of the Chromium build. Content is byte-identical
   to speusis-chromium (same manifest, same engine) - these exist purely so
   each browser has its own clearly-labeled zip to upload/reference, since
   "one file, which browser is this for" questions come up otherwise. */
const CHROMIUM_ALIASES = [
  { name: "speusis-chrome", label: "Chrome" },
  { name: "speusis-edge",   label: "Edge" },
  { name: "speusis-brave",  label: "Brave" },
  { name: "speusis-arc",    label: "Arc" },
];

/* ── Helpers ───────────────────────────────────────────────────── */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  } else {
    console.warn(`  [WARN] Missing file, skipping: ${path.basename(src)}`);
  }
}

function zipDir(dir, zipPath) {
  /* Use the system zip command (available on macOS and Linux) */
  const rel = path.relative(DIST, dir);
  try {
    execSync(`cd "${DIST}" && zip -r "${path.basename(zipPath)}" "${rel}"`, {
      stdio: "pipe",
    });
    console.log(`  Zipped → ${path.relative(SRC, zipPath)}`);
  } catch {
    console.warn(`  [WARN] zip not available — skipping ${path.basename(zipPath)}`);
  }
}

/* ── Build ─────────────────────────────────────────────────────── */
ensureDir(DIST);

for (const target of TARGETS) {
  const outDir = path.join(DIST, target.name);
  ensureDir(outDir);

  console.log(`\nBuilding ${target.label} → dist/${target.name}/`);

  /* Copy shared source files */
  for (const file of SHARED_FILES) {
    copyFile(path.join(SRC, file), path.join(outDir, file));
  }

  /* Copy the correct manifest as "manifest.json" */
  copyFile(
    path.join(SRC, target.manifestSrc),
    path.join(outDir, "manifest.json")
  );

  /* Zip for distribution / submission */
  zipDir(outDir, path.join(DIST, `${target.name}.zip`));

  console.log(`  Done ✓`);
}

/* ── Named Chromium aliases (Chrome / Edge / Brave / Arc) ─────────── */
const chromiumDir = path.join(DIST, "speusis-chromium");
for (const alias of CHROMIUM_ALIASES) {
  const outDir = path.join(DIST, alias.name);
  ensureDir(outDir);
  console.log(`\nCopying Chromium build → dist/${alias.name}/ (${alias.label})`);
  for (const file of fs.readdirSync(chromiumDir)) {
    fs.copyFileSync(path.join(chromiumDir, file), path.join(outDir, file));
  }
  zipDir(outDir, path.join(DIST, `${alias.name}.zip`));
  console.log(`  Done ✓`);
}

console.log(`
┌─────────────────────────────────────────────────────┐
│  Speusis Downloader Extension Build Complete                     │
├─────────────────────────────────────────────────────┤
│  Chrome  →  dist/speusis-chrome.zip                  │
│  Edge    →  dist/speusis-edge.zip                    │
│  Brave   →  dist/speusis-brave.zip                    │
│  Arc     →  dist/speusis-arc.zip                     │
│  (all four are identical Chromium/MV3 builds,        │
│   dist/speusis-chromium.zip kept too, same content)   │
│  Firefox 109+ →  dist/speusis-firefox.zip             │
├─────────────────────────────────────────────────────┤
│  Safari                                             │
│    Open dist/speusis-chromium/ in Xcode via:          │
│    File > New > Project > Safari Extension          │
│    "Convert Existing Extension"                     │
└─────────────────────────────────────────────────────┘
`);
