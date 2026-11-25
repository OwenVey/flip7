import type { Player } from "../game/engine";

/** Highest total first. Tied totals share a rank, and the next rank skips past them. */
export const rankPlayers = (players: readonly Player[]) => {
  const sorted = players.toSorted((a, b) => b.score - a.score);
  let rank = 1;

  return sorted.map((player, index) => {
    if (index > 0 && player.score !== sorted[index - 1]?.score) {
      rank = index + 1;
    }

    return { index, player, rank };
  });
};
