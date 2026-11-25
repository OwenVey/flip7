import { routePartykitRequest } from "partyserver";
import app from "virtual:solid-ssr-handler";

import { normalizeCode, ROOM_PARTY } from "../src/game/protocol";
import { isFileRequest } from "./file-request";

export { GameRoom } from "./room";

const PARTY_PATH = `/parties/${ROOM_PARTY}/`;

const notFound = () => new Response("Not found", { status: 404 });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (isFileRequest(pathname)) {
      return notFound();
    }

    if (!pathname.startsWith(PARTY_PATH)) {
      return await app.fetch(request);
    }

    const code = normalizeCode(pathname.slice(PARTY_PATH.length));

    if (code !== null) {
      url.pathname = `${PARTY_PATH}${code}`;

      const routed = new Request(url, request);
      routed.headers.delete("x-partykit-props");

      const response = await routePartykitRequest(routed, env);

      if (response) {
        return response;
      }
    }

    return notFound();
  },
} satisfies ExportedHandler<Env>;
