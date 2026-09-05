import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDownloadsStore } from "@/stores/downloads";
import type { AppEvent } from "./types";

/**
 * main.rs republishes every speusis_core::event_bus::AppEvent to the
 * webview as a single Tauri event named "event-bus" (see main.rs:79:
 * `app.emit("event-bus", event)`). One listener, tagged-union payload -
 * mirrors exactly what the old vanilla renderer's downloadManagerBridge.js
 * subscribed to, so behavior doesn't change, only who's listening.
 */
export function useEventBus() {
  const applyProgress = useDownloadsStore((s) => s.applyProgress);
  const applyStatus = useDownloadsStore((s) => s.applyStatus);
  const refresh = useDownloadsStore((s) => s.refresh);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<AppEvent>("event-bus", (evt) => {
      const payload = evt.payload;
      switch (payload.type) {
        case "DownloadProgress":
          applyProgress(payload.data as any);
          break;
        case "DownloadStarted":
        case "DownloadCompleted":
        case "DownloadFailed":
        case "DownloadPaused":
        case "DownloadResumed":
        case "TorrentFilesReady":
          applyStatus(payload.type, payload.data as any);
          break;
        default:
          // RssFeedFetched / TorrentPeerAdded / scheduler events etc. -
          // no list-view state to update yet, but a full refresh keeps
          // everything else honest without special-casing each one.
          refresh();
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, [applyProgress, applyStatus, refresh]);
}
