# Languages

This folder holds the translation tables Speusis loads at runtime. One file
per language, named by its language code, each a flat JSON object of
`"<key>": "<text>"` pairs.

`en.json` is the source of truth: every user-facing English string in the
app (button labels, dialog text, placeholders, tooltips, status messages,
settings labels, per-download status and security-scan badges). All other
files carry **exactly the same 487 keys**, in the same order.

## Shipped languages

English plus 18 translations:

| Code | Language | | Code | Language |
|---|---|---|---|---|
| `en` | English | | `ko` | Korean |
| `ar` | Arabic *(right-to-left)* | | `pl` | Polish |
| `zh-CN` | Chinese (Simplified) | | `pt-BR` | Portuguese (Brazil) |
| `da` | Danish | | `pt-PT` | Portuguese (Portugal) |
| `nl` | Dutch | | `ro` | Romanian |
| `fr` | French | | `ru` | Russian |
| `de` | German | | `es` | Spanish |
| `id` | Indonesian | | `sv` | Swedish |
| `it` | Italian | | `tr` | Turkish |
| `ja` | Japanese | | | |

## Editing translations

These files are plain text — open one, change a value, restart Speusis.
You do not need to rebuild the app.

Rules worth knowing before you edit:

- **Change values, not keys.** The key on the left is what the app looks
  up. Renaming or removing one makes that string fall back to English.
- **Missing or empty values fall back to English automatically**, per
  string. A partial or half-finished edit degrades to English on the
  affected strings only — it can never blank the UI.
- **A file that fails to parse** (a stray comma, an unescaped quote) makes
  that whole language fall back to English, with a warning in the
  developer console. The app still runs.
- **Leave these verbatim:** the product names `Speusis`, `Speusis Basket`,
  `Speusis Downloader`, `Nulltrace`; addresses and URLs
  (`karimsc01t@gmail.com`, `speusis.app`, `127.0.0.1:9999`, `0.0.0.0`);
  third-party names (`Windows Defender`, `Firefox`, `Chrome / Edge / Brave / Arc`,
  `RSS`, `BitTorrent`, `FTP/FTPS`, `.torrent`); the shortcut `Ctrl+M`; and the
  license-key placeholder `XXXX-XXXX-XXXX-XXXX`.
- **Keep the punctuation and symbols** a value carries — trailing colons
  (`"Added:"`), ellipses (`…`), arrows and dashes (`←`, `↓`, `▶`, `—`), and
  the checkmark in `"✓ Activated"`. The UI relies on them.
- **The language-name keys** (`arabic`, `japanese`, `persian`, …) are the
  names shown in the Settings → Language dropdown. They are deliberately
  identical across all files, so each language is listed in its own script
  no matter which language the UI is currently in. Don't translate them.
- A few keys carry a `_2` / `_3` suffix. Those are separate UI locations
  that share the same slug but need their own text — they are not
  duplicates to merge.

## Adding a language

1. Copy `en.json` to `<code>.json` (e.g. `cs.json`).
2. Translate the values, leaving every key as-is.
3. Add the code to `SUPPORTED` in `dist/renderer/i18n.js` (set
   `rtl: true` for right-to-left scripts).
4. Add a matching `<option>` to the language `<select>` in
   `dist/renderer/index.html`.

Steps 3 and 4 are inside the app bundle, so a new language needs a rebuild
to appear in the dropdown. Editing an existing language does not.
