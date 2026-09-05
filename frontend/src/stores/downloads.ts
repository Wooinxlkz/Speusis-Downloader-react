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

export const useDownloadsStore = create<DownloadsState>((set, get) => ({
  tasks: [],
  loaded: false,
  selectedId: null,
  live: {},

  refresh: async () => {
    const tasks = await ipc.downloadList();
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
    ipc.downloadList().then((tasks) => set({ tasks }));
    void data;
  },

  select: (id) => set({ selectedId: id }),
}));
