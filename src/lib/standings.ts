import type { Player } from "../game/engine";
import type { RoomView } from "../game/protocol";

/** Highest total first. Tied totals share a rank, and the next rank skips past them. */
export const rankPlayers = <T extends Pick<Player, "score">>(
  players: readonly T[]
) => {
  const sorted = players.toSorted((a, b) => b.score - a.score);
  let rank = 1;

  return sorted.map((player, index) => {
    if (index > 0 && player.score !== sorted[index - 1]?.score) {
      rank = index + 1;
    }

    return { index, player, rank };
  });
};

/** A player in the final standings, who may have left since the game ended. */
export type FinalPlayer = Pick<
  Player,
  "avatar" | "bot" | "id" | "lastRound" | "name" | "score" | "status"
> & { left: boolean };

/**
 * Everyone who finished the game, ranked. A winner who has since left keeps
 * their place, with the name and total the game recorded when they won.
 */
export const finalStandings = (room: Pick<RoomView, "players" | "winner">) => {
  const players: FinalPlayer[] = room.players.map((player) => ({
    ...player,
    left: false,
  }));

  const { winner } = room;

  if (winner !== null && !players.some(({ id }) => id === winner.id)) {
    players.push({
      avatar: null,
      bot: false,
      id: winner.id,
      lastRound: null,
      left: true,
      name: winner.name,
      score: winner.points,
      status: "out",
    });
  }

  return rankPlayers(players);
};

/** The winners' names, for a headline. */
export const winnerNames = (
  room: Pick<RoomView, "players" | "winner" | "winnerIds">
) => {
  const winnerIds = new Set(room.winnerIds);
  const names: string[] = [];

  for (const { player } of finalStandings(room)) {
    if (winnerIds.has(player.id)) {
      names.push(player.name);
    }
  }

  return names;
};

/** Headline naming the winners: "Ana wins!" or "Ana and Ben win!". */
export const winnersHeadline = (names: readonly string[]) =>
  names.length > 1
    ? `${names.join(" and ")} win!`
    : `${names[0] ?? "Someone"} wins!`;
