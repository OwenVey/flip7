import type { RoomView } from "../game/protocol";

export const nameOf = (room: Pick<RoomView, "players">, id: string | null) =>
  room.players.find((player) => player.id === id)?.name ?? "Someone";
