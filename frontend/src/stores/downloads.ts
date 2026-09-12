import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import type { DownloadProgress, DownloadTask } from "@/lib/types";

interface LiveStat {
  speed: number;
  eta: number;
}

interface DownloadsState {
  tasks: DownloadTask[];
  loaded: boolean;
  selectedId: string | null;
  live: Record<string, LiveStat>;
  refresh: () => Promise<void>;
  applyProgress: (p: DownloadProgress) => void;
  applyStatus: (kind: string, data: { id: string }) => void;
  select: (id: string | null) => void;
}

// Status-changing events (started/completed/scan-finished/etc.) can arrive
// back-to-back for the same task, and each one kicks off its own
// ipc.downloadList() round-trip. Those round-trips aren't guaranteed to
// resolve in the order they were sent - on a fast IPC bridge under load
// (a burst of events on a big torrent, several downloads finishing near
// simultaneously) an older response can land after a newer one and stomp
// fresh state with stale data. A simple monotonic counter fixes that: only
// the response from the most recently *started* request is allowed to win.
let refreshSeq = 0;

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  tasks: [],
  loaded: false,
  selectedId: null,
  live: {},

  refresh: async () => {
    const seq = ++refreshSeq;
    const tasks = await ipc.downloadList();
    if (seq !== refreshSeq) return; // a newer refresh already landed
    set({ tasks, loaded: true });
  },

  // Applied on every DownloadProgress tick instead of a full re-fetch -
  // the list can hold hundreds of tasks and re-fetching all of them on
  // every progress tick (multiple times a second, per active download)
  // would be wasteful; only the byte counters actually change. speed/eta
  // aren't persisted DownloadTask fields (the backend only reports them
  // in the event), so they live in a side map instead of the task itself.
  applyProgress: (p) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === p.id
          ? { ...t, receivedBytes: p.bytesReceived, size: p.size ?? t.size }
          : t,
      ),
      live: { ...state.live, [p.id]: { speed: p.speed, eta: p.eta } },
    })),

  // Status-changing events (started/paused/resumed/completed/failed) touch
  // more than the progress counters (status, timestamps, output path) -
  // simplest correct thing is to pull that one task fresh rather than
  // hand-patch every field the backend might have changed.
  applyStatus: (_kind, data) => {
    const seq = ++refreshSeq;
    ipc.downloadList().then((tasks) => {
      if (seq !== refreshSeq) return; // a newer refresh already landed
      set({ tasks, loaded: true });
    });
    void data;
  },

  select: (id) => set({ selectedId: id }),
}));
