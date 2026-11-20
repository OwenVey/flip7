import app from "virtual:solid-ssr-handler";

import { normalizeCode } from "../src/game/protocol";

export { GameRoom } from "./room";

const ROOM_SOCKET_PATH = /^\/api\/rooms\/(?<code>[^/]+)\/socket$/u;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith("/api/")) {
      const match = ROOM_SOCKET_PATH.exec(pathname);
      const code = normalizeCode(match?.groups?.code ?? "");

      if (code === null) {
        return new Response("Not found", { status: 404 });
      }

      return await env.GAME_ROOM.getByName(code).fetch(request);
    }

    return await app.fetch(request);
  },
} satisfies ExportedHandler<Env>;
