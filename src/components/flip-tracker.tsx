import PlayingCardsFan from "@lucide/solid/icons/playing-cards-fan";
import { createEffect, createMemo, createSignal, Repeat, Show } from "solid-js";

import type { Card } from "../game/cards";
import { FLIP_THREE_COUNT } from "../game/engine";
import type { RoomView } from "../game/protocol";
import { stepPlayerId } from "../lib/deal-plan";
import type { DealStep } from "../lib/deal-plan";
import { motionAllowed } from "../lib/motion";
import PlayingCard from "./playing-card";

interface FlipProgress {
  flipped: number;
  total: number;
  waiting: boolean;
}

export const flipProgress = (
  room: RoomView,
  step: DealStep | null | undefined,
  playerId: string
) => {
  if (step?.to.kind === "played" && step.to.playerId === playerId) {
    const progress: FlipProgress = {
      flipped: 0,
      total: FLIP_THREE_COUNT,
      waiting: false,
    };

    return progress;
  }

  if (step?.flip && stepPlayerId(step) === playerId) {
    const progress: FlipProgress = {
      flipped: step.flip.index,
      total: step.flip.total,
      waiting: false,
    };

    return progress;
  }

  const run = room.flips.findLast((flip) => flip.targetId === playerId);

  if (!run) {
    return null;
  }

  const progress: FlipProgress = {
    flipped: FLIP_THREE_COUNT - run.remaining,
    total: FLIP_THREE_COUNT,
    waiting: true,
  };

  return progress;
};

export const sameProgress = (a: FlipProgress | null, b: FlipProgress | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.flipped === b.flipped &&
    a.total === b.total &&
    a.waiting === b.waiting);

const FLIP_EXIT_MS = 220;

interface ShownFlip {
  progress: FlipProgress;
  leaving: boolean;
}

export const createShownFlip = (flip: () => FlipProgress | null) => {
  const [shown, setShown] = createSignal<ShownFlip | null>((previous) => {
    const progress = flip();

    if (progress) {
      return { leaving: false, progress };
    }

    return previous && motionAllowed()
      ? { leaving: true, progress: previous.progress }
      : null;
  });

  const clearAfterExit = () => {
    const timer = setTimeout(() => {
      setShown(null);
    }, FLIP_EXIT_MS);

    return () => {
      clearTimeout(timer);
    };
  };

  createEffect(
    () => shown()?.leaving === true,
    (leaving) => (leaving ? clearAfterExit() : undefined)
  );

  return shown;
};

const FlipTracker = (props: {
  progress: FlipProgress;
  leaving: boolean;
  card: Card | null;
}) => {
  const pipCount = createMemo(() => props.progress.total);

  return (
    <div
      class="flip-run"
      data-waiting={props.progress.waiting ? "" : undefined}
      data-leaving={props.leaving ? "" : undefined}
      style={{ "--flip-exit": `${FLIP_EXIT_MS}ms` }}
    >
      <PlayingCardsFan size={12} aria-hidden="true" />
      <span class="flip-run-label">Flip Three</span>
      <span class="flip-pips" aria-hidden="true">
        <Repeat count={pipCount()}>
          {(index) => (
            <span
              class="flip-pip"
              data-filled={index < props.progress.flipped ? "" : undefined}
              data-current={
                !props.progress.waiting && index === props.progress.flipped - 1
                  ? ""
                  : undefined
              }
            />
          )}
        </Repeat>
      </span>
      <span class="sr-only">
        {`, ${props.progress.flipped} of ${props.progress.total} flipped`}
      </span>
      <Show when={props.card}>
        {(card) => (
          <ul class="flip-run-card" aria-hidden="true">
            <PlayingCard card={card()} size="mini" />
          </ul>
        )}
      </Show>
    </div>
  );
};

export default FlipTracker;
