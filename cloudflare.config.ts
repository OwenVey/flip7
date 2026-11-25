import { bindings, defineConfig, defineWorker, exports } from "cf/config";

import * as entrypoint from "./worker" with { type: "cf-worker" };

const gameWorker = defineWorker({
  assets: {
    // WARNING: run_worker_first needs a non-negative rule; "/" already reaches the Worker.
    runWorkerFirst: ["/", "!/.*", "!/*/.*"],
  },
  compatibilityDate: "2026-07-22",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint,
  exports: {
    GameRoom: exports.durableObject({ storage: "sqlite" }),
  },
  name: "flip7",
  observability: { enabled: true },
  previewUrls: true,
  workersDev: false,
});

export default defineConfig({
  worker: {
    ...gameWorker,
    env: {
      GAME_ROOM: bindings.durableObject({
        exportName: "GameRoom",
        worker: gameWorker,
      }),
    },
  },
});
