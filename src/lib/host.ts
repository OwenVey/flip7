import type { RoomView } from "../game/protocol";

/** The host's name for waiting messages, or "the host" if they have left. */
export const hostName = (room: Pick<RoomView, "hostId" | "players">) =>
  room.players.find((player) => player.id === room.hostId)?.name ?? "the host";
