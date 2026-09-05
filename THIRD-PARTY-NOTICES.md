# Third-Party Notices

Speusis Downloader is proprietary software (see [`LICENSE.md`](./LICENSE.md)), but it is
built on top of open-source components. Several of them — in particular
[`librqbit`](https://github.com/ikatson/rqbit) (Apache-2.0) — are licensed under terms
that require their own copyright and license notices to be preserved in any distributed
binary. This file exists to satisfy that requirement and to be transparent about what's
inside the app.

## How this list was compiled

The table below covers the direct dependencies declared in `speusis-core/Cargo.toml` and
`src-tauri/Cargo.toml`, checked against their published crates.io license metadata. It
does **not** enumerate the full transitive dependency tree (a modern Rust binary this size
easily pulls in 150–400 transitive crates), and it is accurate as of the versions pinned
at the time this file was written — not automatically kept in sync with `Cargo.lock`.

**Before cutting a real release, generate the exhaustive, automated version of this file**
instead of relying on the hand-curated list below:

```bash
cargo install cargo-license
cargo license --json > full-dependency-licenses.json
# or, for a ready-to-ship NOTICE file with full license texts bundled in:
cargo install cargo-about
cargo about generate about.hbs > THIRD-PARTY-NOTICES-FULL.html
```

Do this any time a dependency is added, removed, or upgraded — this hand-written summary
will drift out of date otherwise.

## Direct dependencies (speusis-core / src-tauri)

| Crate | License | Notes |
|---|---|---|
| [`librqbit`](https://github.com/ikatson/rqbit) | Apache-2.0 | BitTorrent engine — DHT, tracker, peer protocol |
| [`lava_torrent`](https://github.com/ttlajus/lava_torrent) | MIT OR Apache-2.0 | `.torrent` file parsing/creation |
| [`tiny_http`](https://github.com/tiny-http/tiny-http) | Apache-2.0 | Local HTTP listener (browser-extension bridge, streaming server) |
| `zip` | MIT | Archive Manager — ZIP read/write |
| `tar` | MIT OR Apache-2.0 | Archive Manager — TAR/TAR.GZ read |
| `flate2` | MIT OR Apache-2.0 | Deflate backend used by the archive/zip crates |
| `reqwest` | MIT OR Apache-2.0 | HTTP client |
| `tokio` / `tokio-util` | MIT | Async runtime |
| `serde` / `serde_json` | MIT OR Apache-2.0 | Serialization |
| `chrono` | MIT OR Apache-2.0 | Date/time handling |
| `uuid` | MIT OR Apache-2.0 | Task/device ID generation |
| `sha1`, `sha2` | MIT OR Apache-2.0 | Hashing (license-key validation, torrent piece verification) |
| `hex`, `base64` | MIT OR Apache-2.0 | Encoding |
| `url`, `percent-encoding` | MIT OR Apache-2.0 | URL parsing |
| `thiserror`, `anyhow` | MIT OR Apache-2.0 | Error handling |
| `dirs` | MIT OR Apache-2.0 | OS config-directory resolution |
| `regex` | MIT OR Apache-2.0 | Pattern matching (web grabber, IP blocklist) |
| `async-trait`, `async-recursion` | MIT OR Apache-2.0 | Async language extensions |
| `futures`, `bytes` | MIT OR Apache-2.0 | Async/byte-buffer utilities |
| Tauri (`tauri`, `tauri-build`, plugin crates) | MIT OR Apache-2.0 | Application shell/runtime |

Every license listed above is a standard permissive OSS license (MIT and/or Apache-2.0).
**None of Speusis's direct dependencies are copyleft** (GPL/LGPL/AGPL) as of this writing —
that matters specifically because copyleft licenses can impose source-disclosure
obligations that would be incompatible with distributing Speusis as closed-source
proprietary software. If a future dependency change introduces a copyleft-licensed crate,
this needs to be re-evaluated before release.

## Full license texts

Apache-2.0 and MIT both require the license text to be reproducible on request:

- Apache License 2.0: <https://www.apache.org/licenses/LICENSE-2.0>
- MIT License: <https://opensource.org/licenses/MIT>

For a build that ships the full verbatim text of every dependency's license (what you'd
actually want bundled into a shipped installer for full compliance), use `cargo about`
as shown above and include its output alongside the app.
