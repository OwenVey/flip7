import { calculateRoundScore } from "../game/cards";
import type { Player } from "../game/engine";
import type { RoomView } from "../game/protocol";

/**
 * Round points in play can still be lost to a bust. Locked points are safe:
 * the player stayed, was frozen or flipped 7.
 */
export type RoundRisk = "none" | "at-risk" | "locked";

/**
 * What a player's score meter shows: the total they've banked, the round
 * points on top of it, the points a bust just cost them, and how safe the
 * round points are. `details` reads the round points and target aloud after
 * the total.
 */
export const scoreMeter = (
  player: Pick<Player, "hand" | "score" | "status">,
  phase: RoomView["phase"],
  roundPoints: number,
  targetScore: number
) => {
  const playing = phase === "playing";
  const banked = player.score;
  const round = playing ? roundPoints : 0;
  const projected = banked + round;
  const atTarget = projected >= targetScore;

  const lost =
    playing && player.status === "busted"
      ? calculateRoundScore(player.hand).total
      : 0;

  let risk: RoundRisk = "locked";

  if (round <= 0) {
    risk = "none";
  } else if (playing && player.status === "active") {
    risk = "at-risk";
  }

  const details = [
    ...(round > 0 ? [`${round} this round`] : []),
    ...(atTarget ? ["at the target"] : []),
  ];

  return { atTarget, banked, details, lost, projected, risk, round };
};
