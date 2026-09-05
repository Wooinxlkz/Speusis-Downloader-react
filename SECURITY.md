# Security Policy

## Supported versions

Only the latest released version of Speusis Downloader (currently `v0.5.51`) receives
security fixes. There is no long-term-support branch at this stage of the project.

## Reporting a vulnerability

If you find a security issue in Speusis Downloader — the desktop app, the browser
extension, or the license/activation system — please report it privately rather than
opening a public GitHub issue. Public issues are fine for regular bugs; for anything with
security impact (remote code execution, license-check bypass, an SSRF/path-traversal in
the downloader itself, credential handling, etc.), open a
[private security advisory](https://github.com/Wooinxlkz/Speusis-Downloader/security/advisories/new)
on this repository, or contact the maintainer directly through GitHub.

Please include, where possible:

- A clear description of the issue and its impact
- Steps to reproduce (a minimal repro is enormously helpful)
- The affected version/commit
- Whether you believe it's remotely exploitable or requires local access

## What to expect

This is currently a solo-maintained project, so response times won't match a company
security team's SLA — but reports will be acknowledged and looked at, and credited (if
you want credit) once a fix ships. Please give a reasonable amount of time to investigate
and patch before any public disclosure.

## Scope notes specific to this app

A few things that are **known, intentional trade-offs** rather than vulnerabilities worth
reporting on their own:

- **License validation is local/offline** (see the README's Security Model section and
  `LICENSE.md` §5). It is not designed to resist a determined attacker with a decompiler,
  and reports of "the license check can be bypassed by patching the binary" are a known,
  accepted limitation of any offline license scheme, not a novel finding. Reports of a
  **practical, low-effort, remote** way to generate valid keys (breaking the key-derivation
  scheme itself, not the binary) are of real interest, though.
- **BitTorrent/DHT functionality inherently exposes your IP to peers and trackers** — this
  is a property of the protocol, not a bug in Speusis.
- The bundled security scan invokes Windows Defender as a convenience layer; it is not a
  guarantee of file safety, and "the scanner didn't catch a file I know is malicious" is
  an antivirus-engine limitation, not a Speusis defect.

Genuine memory-safety issues, injection vulnerabilities, credential leakage, or anything
that lets one user's install affect another's are all very much in scope.
