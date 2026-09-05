import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MainShell } from "@/components/layout/MainShell";
import { DialogsRoot } from "@/components/dialogs/DialogsRoot";
import { useUIStore, type DialogName } from "@/stores/ui";
import { useSettingsStore } from "@/stores/settings";
import { useDownloadsStore } from "@/stores/downloads";
import { useEventBus } from "@/lib/useEventBus";
import { ipc } from "@/lib/ipc";

// Maps the ?panel= query param (see src-tauri/src/commands.rs ->
// native_panel_config) to the in-page dialog that already implements it.
// Most of Speusis's "panels" are normally shown as in-page overlays inside
// the main window (see the old app.js's `isNativePanelWindow` branch) -
// this only kicks in for the cases where panel_open() actually spun up a
// separate always-on-top OS window for one.
const PANEL_TO_DIALOG: Record<string, DialogName> = {
  addUrlPanel: "addUrl",
  settingsPanel: "settings",
  schedulerPanel: "settings",
  loginsPanel: "logins",
  rssPanel: "rss",
  batchPanel: "batch",
  createTorrentPanel: "createTorrent",
  aboutPanel: "about",
  helpPanel: "help",
  registrationPanel: "registration",
  grabberPanel: "grabber",
  torrentFilesPanel: "torrentFiles",
  renameDialog: "rename",
  propertiesDialog: "properties",
  deleteConfirmDialog: "deleteConfirm",
  segmentMapDialog: "segmentMap",
};

function usePanelParam() {
  const params = new URLSearchParams(window.location.search);
  const panel = params.get("panel");
  const id = params.get("id") ?? undefined;
  return { panel, id };
}

export default function App() {
  const { panel, id } = usePanelParam();
  const [ready, setReady] = useState(false);
  const load = useSettingsStore((s) => s.load);
  const refresh = useDownloadsStore((s) => s.refresh);
  useEventBus();

  useEffect(() => {
    Promise.all([load(), refresh()]).finally(() => setReady(true));

    if (panel) {
      const dialog = PANEL_TO_DIALOG[panel];
      if (dialog) {
        const tab = panel === "schedulerPanel" ? "schedule" : undefined;
        if (tab) useUIStore.getState().openSettingsAt(tab);
        else useUIStore.getState().open(dialog, id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return <div className="grid h-screen w-screen place-items-center bg-bg text-faint">Loading…</div>;
  }

  if (panel) {
    return (
      <div className="h-screen w-screen bg-transparent">
        <DialogsRoot />
      </div>
    );
  }

  return (
    <>
      <MainShell />
      <DialogsRoot />
    </>
  );
}

// A panel window's close button should close the OS window it lives in,
// not just clear local dialog state - patch useUIStore.close for that case.
if (new URLSearchParams(window.location.search).get("panel")) {
  const panelName = new URLSearchParams(window.location.search).get("panel")!;
  const originalClose = useUIStore.getState().close;
  useUIStore.setState({
    close: () => {
      originalClose();
      ipc.panelClose(panelName).catch(() => {});
      getCurrentWindow()
        .hide()
        .catch(() => {});
    },
  });
}
