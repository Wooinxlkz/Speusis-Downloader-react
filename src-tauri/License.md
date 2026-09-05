# Speusis Downloader — End-User License Agreement (EULA)

**Version 2.0 — supersedes and replaces `src-tauri/license.txt` wherever the two conflict.**
Copyright © 2026 the Speusis Downloader author(s) ("Licensor"). All rights reserved.

> **Fill in before publishing:** legal name/entity, jurisdiction for §11, and a contact
> address. Bracketed placeholders (`[ ... ]`) must be replaced. This document is a strong
> starting draft, not a substitute for review by a lawyer licensed in your jurisdiction —
> see the note at the very end.

---

## 0. Source-available, not open source

This repository is publicly visible on GitHub for transparency, portfolio, and code-review
purposes only. **Public visibility does not grant any license.** No GitHub feature (view,
clone, fork, star, or otherwise) constitutes permission to use, copy, modify, compile,
distribute, or create derivative works from this software beyond what GitHub's own Terms
of Service require Licensor to permit (e.g., viewing and forking within GitHub itself).
Every other right is governed exclusively by this Agreement.

If no separate open-source license file (e.g. `MIT`, `Apache-2.0`, `GPL`) is present in
this repository, **all rights are reserved by default under copyright law**, and this
EULA is the only license under which any use is authorized.

## 1. Definitions

- **"Software"** means Speusis Downloader in all forms distributed by Licensor: the
  compiled desktop application, the `speusis-core` engine, the browser extension
  (source and pre-built packages), installers, associated documentation, and any update
  or patch Licensor provides.
- **"You" / "Licensee"** means the individual or legal entity that installs, accesses,
  or uses the Software.
- **"License Key"** means the activation credential issued by Licensor or Licensor's
  authorized key-generation tooling that unlocks a specific plan tier (Trial, Monthly,
  Lifetime).

## 2. Grant of license

Subject to your compliance with this Agreement and, where applicable, valid payment and
activation of a License Key, Licensor grants you a limited, non-exclusive,
non-transferable, non-sublicensable, revocable license to:

(a) install and run one (1) copy of the compiled Software per activated License Key, on
devices you own or control, for your personal or internal business use; and

(b) view the source code in this repository for evaluation, security review, and
compatibility-checking purposes only.

No other rights are granted, whether by implication, estoppel, or otherwise. Specifically,
**this Agreement does not grant you any right to**: redistribute the Software or source
code (modified or unmodified); sell, rent, lease, or sublicense the Software; use the
Speusis name, logo, or branding; or use any portion of the source code in another product,
whether commercial or non-commercial, open-source or proprietary.

## 3. Ownership; intellectual property

### 3.1 Copyright
The Software, including all source code, object code, documentation, UI/UX design, icons,
and branding assets, is the exclusive property of Licensor and is protected by copyright
law and international treaty. This Agreement does not transfer any ownership rights to
you — you receive only the limited license expressly stated in §2.

### 3.2 Trademarks
"Speusis" and "Speusis Downloader," and the associated logo/icon assets in this
repository, are trademarks (registered or unregistered, as applicable) of Licensor. No
license to use these marks is granted by this Agreement, by access to this repository, or
by use of the Software. Do not use them to name, brand, or market a fork, derivative, or
competing product.

### 3.3 Trade secrets
Certain portions of the Software — including but not limited to the license-key
derivation scheme in `speusis-core/src/license.rs`, the salt value it uses, and any
device-locking implementation details — constitute trade secrets of Licensor. Even where
this repository is publicly readable, accessing, extracting, reverse-engineering, or
republishing these specific mechanisms for the purpose of generating unauthorized license
keys or defeating activation is a misappropriation of trade secrets and a violation of
this Agreement, independent of copyright law.

### 3.4 Patents — no claim, no license
**Licensor does not currently hold an issued patent covering the Software** and this
Agreement makes no representation that any patent application is pending. No patent
rights, express or implied, are licensed under this Agreement. If Licensor obtains patent
protection for any aspect of the Software in the future, this Agreement will be updated
accordingly and no rights under such patent are granted retroactively or by implication
today. (If and when you do file a patent application, this section should be replaced
with a "Patent Pending — Application No. [ ... ], filed [ date ]" notice, and only then.)

### 3.5 Feedback
If you submit bug reports, feature requests, or suggestions, you grant Licensor a
perpetual, irrevocable, worldwide, royalty-free license to use them without restriction
or obligation to you.

## 4. Restrictions

You must not, and must not permit or assist any third party to:

1. Copy, redistribute, sublicense, sell, rent, lease, or publicly host the Software or
   any portion of its source code, except as expressly permitted in §2.
2. Reverse-engineer, decompile, or disassemble the compiled application binary, **except
   to the extent such restriction is expressly prohibited by applicable law
   notwithstanding this limitation** (e.g., interoperability exceptions under EU Directive
   2009/24/EC or equivalent local law), and then only to the minimum extent that law
   requires.
3. Circumvent, disable, tamper with, or attempt to defeat the License Key validation,
   device-lock, or any other access-control or technical-protection mechanism in the
   Software, or distribute any tool whose purpose is to do so (e.g., key generators,
   patches, or cracks).
4. Remove, obscure, or alter any copyright, trademark, or proprietary-rights notice
   included in the Software.
5. Use the Software to build a competing product, or use the source code, in whole or in
   part, in another software project.
6. Use the Software for any unlawful purpose, or to download, distribute, or facilitate
   access to content you do not have the legal right to access — see §6.
7. Misrepresent your affiliation with Licensor, or state or imply that a modified or
   redistributed copy is official, endorsed, or supported by Licensor.

## 5. License Keys and activation

- License Keys are issued per §2(a) and are tied to the plan tier purchased (Trial,
  Monthly, or Lifetime) and, where the plan is device-locked, to a specific device ID
  generated at first activation.
- You are responsible for keeping your License Key confidential. Sharing a key with, or
  using a key across, more devices/users than your plan permits is a breach of this
  Agreement and grounds for immediate revocation without refund.
- Licensor may, at its discretion, revoke or invalidate previously issued keys (for
  example, in response to a confirmed leak or fraud), consistent with the mechanism
  described in `license.rs`. Where reasonably practicable, Licensor will make a good-faith
  effort to notify affected users and offer a replacement key.
- License validation in this version of the Software is performed locally/offline inside
  the compiled binary. Licensor makes no representation that this mechanism is
  unbreakable — see the README's Security Model section — and reserves the right to
  introduce server-side activation in a future version.

## 6. User responsibility; acceptable use

The Software is a general-purpose download manager. It does not itself locate, endorse,
or verify the legality of any content you choose to download, and Licensor has no
visibility into what you download. **You are solely responsible for**:

- ensuring you have the legal right to access, download, and use any content retrieved
  through the Software, in your jurisdiction and the content's;
- complying with the terms of service of any site, tracker, or FTP server you connect to;
  and
- any consequence of using the BitTorrent/seeding functionality, including your IP
  address being visible to peers/trackers as an inherent property of the BitTorrent
  protocol — this is not a defect in the Software.

The built-in security scan (Windows Defender integration) is a convenience feature only
and is not a guarantee that any downloaded file is safe, virus-free, or fit for any
purpose.

## 7. No warranty

THE SOFTWARE IS PROVIDED **"AS IS" AND "AS AVAILABLE,"** WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. LICENSOR
DOES NOT WARRANT THAT THE SOFTWARE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE, OR THAT
ANY DEFECT WILL BE CORRECTED. NOTHING IN THIS SECTION LIMITS ANY WARRANTY THAT CANNOT BE
LAWFULLY EXCLUDED IN YOUR JURISDICTION.

## 8. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL LICENSOR BE LIABLE
FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF
DATA, PROFITS, OR REVENUE, ARISING OUT OF OR RELATED TO YOUR USE OF OR INABILITY TO USE
THE SOFTWARE, REGARDLESS OF THE LEGAL THEORY, EVEN IF LICENSOR HAS BEEN ADVISED OF THE
POSSIBILITY OF SUCH DAMAGES. LICENSOR'S TOTAL AGGREGATE LIABILITY UNDER THIS AGREEMENT
WILL NOT EXCEED THE AMOUNT YOU ACTUALLY PAID LICENSOR FOR THE SOFTWARE IN THE TWELVE (12)
MONTHS PRECEDING THE CLAIM, OR **[ USD 0 for the free/Trial tier ]**, WHICHEVER IS
GREATER.

## 9. Indemnification

You agree to indemnify, defend, and hold harmless Licensor from any claim, liability,
damage, loss, or expense (including reasonable legal fees) arising out of: (a) your
breach of this Agreement; (b) your violation of any law or third-party right through your
use of the Software, including the content you choose to download or distribute; or (c)
your misuse of the License Key or activation system.

## 10. Term and termination

This Agreement is effective from your first installation or use of the Software and
continues until terminated. It terminates automatically, without notice, if you breach
any term of this Agreement — most importantly §4. Licensor may also terminate a License
Key for the reasons in §5. Upon termination you must stop using the Software and destroy
all copies in your possession. Sections 3, 6, 7, 8, 9, and 11 survive termination.

## 11. Governing law and disputes

This Agreement is governed by the laws of **[ jurisdiction — e.g. "the People's
Democratic Republic of Algeria" or wherever you want to anchor this ]**, without regard to
its conflict-of-law principles. Any dispute arising under this Agreement will be subject
to the exclusive jurisdiction of the courts located in **[ city/country ]**, and you
consent to personal jurisdiction there. Nothing in this section limits either party's
right to seek injunctive relief in any court of competent jurisdiction to protect
intellectual-property rights.

## 12. Export compliance

You represent that you are not located in, and will not use the Software in, a country or
region subject to a comprehensive embargo under applicable export-control law, and that
you are not on any restricted-party list under such law.

## 13. Changes to this Agreement

Licensor may update this Agreement for future releases. Continued use of a version of the
Software released after an update constitutes acceptance of the updated terms for that
version. Material changes will be reflected in this file's version number and repository
history.

## 14. Miscellaneous

- **Entire agreement.** This Agreement, together with `src-tauri/license.txt` where not
  in conflict, is the entire agreement between you and Licensor regarding the Software and
  supersedes any prior agreement or understanding.
- **Severability.** If any provision is held unenforceable, the remaining provisions
  remain in full force, and the unenforceable provision will be reformed to the minimum
  extent necessary to make it enforceable.
- **No waiver.** Licensor's failure to enforce any provision is not a waiver of the right
  to enforce it later.
- **Assignment.** You may not assign this Agreement without Licensor's prior written
  consent. Licensor may assign this Agreement freely, including in connection with a
  merger, acquisition, or sale of assets.

## 15. Contact

For licensing questions, permission requests, or to report a suspected breach of this
Agreement, contact Licensor via the repository at
<https://github.com/Wooinxlkz/Speusis-Downloader> or **[ email address ]**.

---

*This document was drafted to be strong and specific to Speusis Downloader's actual
architecture (local license-key validation, source-available public repo, BitTorrent
functionality, Windows Defender integration), but it is not a substitute for review by a
lawyer licensed where you operate — particularly for §8's liability cap, §11's governing
law/venue, and the export-compliance language in §12, all of which are genuinely
jurisdiction-dependent. Treat this as a strong first draft to have reviewed, not as final
legal advice.*
