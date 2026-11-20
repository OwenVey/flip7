import { bindings, defineConfig, defineWorker, exports } from "cf/config";

import * as entrypoint from "./worker" with { type: "cf-worker" };

const gameWorker = defineWorker({
  compatibilityDate: "2026-07-22",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint,
  exports: {
    GameRoom: exports.durableObject({ storage: "sqlite" }),
  },
  name: "hot-streak",
  observability: { enabled: true },
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
