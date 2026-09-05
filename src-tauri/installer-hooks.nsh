; Custom installer hooks, loaded via bundle.windows.nsis.installerHooks in
; tauri.conf.json. Layers on top of Tauri's own maintained NSIS template.
;
; EARLIER VERSION OF THIS FILE removed: it hand-built an "already running"
; check and an "upgrade detected" message. After pulling Tauri's actual
; current template (crates/tauri-bundler/.../nsis/installer.nsi) to verify
; against real source instead of guessing, both turned out to already be
; built into Tauri's stock installer, and more robustly than the version
; here was:
;   - Already-running check: Tauri calls `CheckIfAppIsRunning` using real
;     process detection (nsis_tauri_utils::FindProcess), not just a window
;     title match like this file did - offers to close and kill it for you.
;   - Upgrade detection: Tauri's built-in PageReinstall page runs early in
;     the wizard, does a real semver comparison of the installed vs new
;     version, and lets the user choose to add/reinstall or uninstall first
;     - a proper wizard page, not just a message box.
; Keeping the old hand-built versions active would have shown duplicate,
; conflicting prompts on top of Tauri's own. Removed rather than left in.
;
; What's added here instead - genuinely not covered by the stock template:

!insertmacro GetRoot
!insertmacro DriveSpace

!macro NSIS_HOOK_PREINSTALL
  ; --- Disk space check ---
  ; Not present in Tauri's stock template. Warns instead of failing
  ; partway through file copying if the target drive is nearly full.
  ${GetRoot} "$INSTDIR" $R0
  ${DriveSpace} "$R0\" "/D=F /S=M" $R1
  ${If} $R1 < 200
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "Less than 200 MB of free space was found on $R0. Setup may fail to complete. Continue anyway?" \
      IDOK disk_space_ok
    Abort
    disk_space_ok:
  ${EndIf}
!macroend

; The .torrent association is registered explicitly here rather than relying
; on bundle.fileAssociations. The explicit ProgID is important: Windows reads
; the icon and open command from the ProgID named by the .torrent extension.
; Writing a guessed "Torrent File" key changes nothing when that is not the
; ProgID Windows is using.
!macro NSIS_HOOK_POSTINSTALL
  ; IMPORTANT: the association itself must NOT be gated behind the icon file
  ; check. An earlier version of this hook wrapped everything - ProgID,
  ; .torrent key, OpenWithProgids, the Applications key - inside a single
  ; ${If} ${FileExists} torrent.ico check. If that path was ever wrong (or
  ; the hook ran before resources finished copying), the ENTIRE block
  ; silently no-op'd - no association at all, not just a missing icon. That
  ; is what was actually happening. Registration now always runs; only the
  ; two DefaultIcon lines are conditional on the icon actually being there.

  ; Stable ProgID for the handler. This is also added to OpenWithProgids so
  ; Windows can show Speusis even when another torrent client is installed.
  WriteRegStr SHCTX "Software\Classes\SpeusisDownloader.Torrent" "" "Speusis Downloader Torrent File"
  WriteRegStr SHCTX "Software\Classes\SpeusisDownloader.Torrent\shell\open\command" "" '"$INSTDIR\Speusis Downloader.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\.torrent" "" "SpeusisDownloader.Torrent"
  WriteRegStr SHCTX "Software\Classes\.torrent\OpenWithProgids" "SpeusisDownloader.Torrent" ""

  ; The "Open with" / "Choose an app" picker does NOT use the ProgID's
  ; DefaultIcon for the app's own list entry - it reads from
  ; Applications\<exe>\DefaultIcon instead, falling back to the first icon
  ; resource baked into the exe (our main app icon) if this key is absent.
  WriteRegStr SHCTX "Software\Classes\Applications\Speusis Downloader.exe\shell\open\command" "" '"$INSTDIR\Speusis Downloader.exe" "%1"'

  ; Icon paths: try the expected resource location first. If it's not there,
  ; fall back to checking directly under $INSTDIR before giving up on the
  ; icon (association above already happened regardless either way).
  ${If} ${FileExists} "$INSTDIR\resources\icons\torrent.ico"
    WriteRegStr SHCTX "Software\Classes\SpeusisDownloader.Torrent\DefaultIcon" "" "$INSTDIR\resources\icons\torrent.ico"
    WriteRegStr SHCTX "Software\Classes\Applications\Speusis Downloader.exe\DefaultIcon" "" "$INSTDIR\resources\icons\torrent.ico"
  ${ElseIf} ${FileExists} "$INSTDIR\icons\torrent.ico"
    WriteRegStr SHCTX "Software\Classes\SpeusisDownloader.Torrent\DefaultIcon" "" "$INSTDIR\icons\torrent.ico"
    WriteRegStr SHCTX "Software\Classes\Applications\Speusis Downloader.exe\DefaultIcon" "" "$INSTDIR\icons\torrent.ico"
  ${ElseIf} ${FileExists} "$INSTDIR\torrent.ico"
    WriteRegStr SHCTX "Software\Classes\SpeusisDownloader.Torrent\DefaultIcon" "" "$INSTDIR\torrent.ico"
    WriteRegStr SHCTX "Software\Classes\Applications\Speusis Downloader.exe\DefaultIcon" "" "$INSTDIR\torrent.ico"
  ${Else}
    ; Icon truly isn't on disk anywhere we know to look. Point DefaultIcon at
    ; the exe itself so at least a real icon shows instead of a broken one,
    ; and drop a marker file so this is easy to spot during testing.
    WriteRegStr SHCTX "Software\Classes\SpeusisDownloader.Torrent\DefaultIcon" "" "$INSTDIR\Speusis Downloader.exe,0"
    FileOpen $R2 "$INSTDIR\TORRENT_ICON_NOT_FOUND.txt" w
    FileWrite $R2 "torrent.ico was not found at resources\icons\, icons\, or root of $INSTDIR during install.$\r$\nCheck where Tauri actually placed the 'icons/torrent.ico' resource and update installer-hooks.nsh."
    FileClose $R2
  ${EndIf}

  ; Tell Explorer to discard its cached association/icon lookup.
  System::Call 'shell32::SHChangeNotify(i, i, i, i) (0x08000000, 0, 0, 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove only the values owned by Speusis. Do not delete the whole .torrent
  ; key because another torrent client may have registered alongside it.
  DeleteRegValue SHCTX "Software\Classes\.torrent\OpenWithProgids" "SpeusisDownloader.Torrent"
  DeleteRegKey SHCTX "Software\Classes\SpeusisDownloader.Torrent"
  DeleteRegKey SHCTX "Software\Classes\Applications\Speusis Downloader.exe"
  ReadRegStr $R0 SHCTX "Software\Classes\.torrent" ""
  ${If} $R0 == "SpeusisDownloader.Torrent"
    DeleteRegValue SHCTX "Software\Classes\.torrent" ""
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i, i, i, i) (0x08000000, 0, 0, 0)'
!macroend
