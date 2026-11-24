import { roundStarted } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import type { DealStep } from "./deal-plan";

/** Outcomes at the local seat that deal playback reports. */
export type HapticOutcome =
  | "bust"
  | "celebrate"
  | "flipThree"
  | "freeze"
  | "saved";

export const landedHaptic = (step: DealStep, playerId: string | null) => {
  const { to, card } = step;

  if (to.kind !== "choice" && to.playerId === playerId) {
    if (to.kind === "bust") {
      return "bust";
    }

    if (to.kind === "discard" && card.kind === "number") {
      return "saved";
    }

    if (to.kind === "hand" && card.kind === "freeze") {
      return "freeze";
    }
  }

  return null;
};

export const settledHaptic = (
  previous: RoomView,
  current: RoomView,
  playerId: string,
  steps: DealStep[]
) => {
  const before = previous.players.find(({ id }) => id === playerId);
  const player = current.players.find(({ id }) => id === playerId);
  const priorStatus = roundStarted(previous, current) ? null : before?.status;

  if (
    (current.phase === "gameOver" &&
      previous.phase !== "gameOver" &&
      current.winnerIds.includes(playerId)) ||
    (player?.status === "flipSeven" && priorStatus !== "flipSeven")
  ) {
    return "celebrate";
  }

  const froze = player?.status === "frozen" && priorStatus !== "frozen";

  if (steps.length > 0) {
    return froze &&
      !steps.some((step) => landedHaptic(step, playerId) === "freeze")
      ? "freeze"
      : null;
  }

  const draws = current.draws.filter(
    (draw) => draw.seq > previous.drawSeq && draw.playerId === playerId
  );

  if (draws.some(({ outcome }) => outcome === "bust")) {
    return "bust";
  }

  if (draws.some(({ outcome }) => outcome === "saved")) {
    return "saved";
  }

  if (froze) {
    return "freeze";
  }

  return draws.some(({ flip }) => flip?.index === 1) ? "flipThree" : null;
};

export const flipThreeHaptic = (
  step: DealStep,
  room: RoomView,
  playerId: string | null
) => {
  const target =
    step.to.kind === "choice" ? room.choice?.chooserId : step.to.playerId;

  return step.flip?.index === 1 && target === playerId ? "flipThree" : null;
};
