import type { RoomView } from "../game/protocol";

/** A player's name, or "Someone" if they have left the room. */
export const nameOf = (room: Pick<RoomView, "players">, id: string | null) =>
  room.players.find((player) => player.id === id)?.name ?? "Someone";
