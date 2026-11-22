import { leavesTable } from "./deal-plan";
import type { DealStep } from "./deal-plan";
import type { DealMotion } from "./deal-playback";
import { discardCards, flyCard, riffleDeck, sweepCards } from "./fly-card";
import { motionAllowed } from "./motion";
import { bump } from "./table-motion";

const cardAt = (cardId: number) => ` [data-card-id="${cardId}"]`;

const handCard = (root: Element, playerId: string, cardId: number | null) =>
  cardId === null
    ? null
    : root.querySelector(
        `[data-seat="${playerId}"] :is(.hand, .seat-extras)${cardAt(cardId)}`
      );

const destination = (root: Element, step: DealStep) => {
  const { to } = step;

  if (to.kind === "choice") {
    return root.querySelector(`[data-choice-card]${cardAt(step.card.id)}`);
  }

  if (to.kind === "held") {
    return root.querySelector(
      `[data-seat="${to.playerId}"] [data-held]${cardAt(step.card.id)}`
    );
  }

  return handCard(root, to.playerId, step.card.id);
};

const deckBack = "[data-deck] .card-back";

const origin = (root: Element, step: DealStep) => {
  const selectors = {
    choice: `[data-choice-card]${cardAt(step.card.id)}`,
    deck: deckBack,
    held: `[data-held]${cardAt(step.card.id)}`,
  };

  return root.querySelector(selectors[step.from]);
};

export const createDealMotion: (
  table: () => HTMLElement | undefined
) => DealMotion = (table) => ({
  allowed: () => "animate" in Element.prototype && motionAllowed(),
  captureFlight: (step, duration) => {
    const root = table();
    const from = root && origin(root, step)?.getBoundingClientRect();

    if (!from || (step.from === "held" && leavesTable(step.to))) {
      return null;
    }

    return async (signal) => {
      const to = destination(root, step);
      const layer = root.querySelector("[data-flight-layer]");

      if (!(layer && to instanceof HTMLElement)) {
        return;
      }

      to.dataset.incoming = "";

      try {
        await flyCard({
          duration,
          faceDown: step.from === "deck",
          from,
          layer,
          signal,
          to,
        });

        if (!signal.aborted) {
          to.dataset.flown = "";
        }
      } finally {
        delete to.dataset.incoming;
      }
    };
  },
  land: async (step, discardDuration, signal) => {
    const root = table();

    if (!root) {
      return;
    }

    if (step.from === "choice" && step.to.kind !== "choice") {
      bump(root.querySelector(`[data-seat="${step.to.playerId}"]`));
    }

    if (!leavesTable(step.to)) {
      return;
    }

    const cards =
      step.from === "held"
        ? [origin(root, step)]
        : [
            handCard(root, step.to.playerId, step.card.id),
            handCard(root, step.to.playerId, step.partnerId),
          ];

    await discardCards(
      cards.filter((card) => card !== null),
      discardDuration,
      signal
    );
  },
  reshuffle: () => {
    const deck = table()?.querySelector(deckBack);

    if (deck) {
      riffleDeck(deck);
    }
  },
  sweep: async (signal) => {
    const root = table();
    const deck = root?.querySelector(deckBack);

    if (root && deck) {
      await sweepCards(
        [...root.querySelectorAll(".seat .card")],
        deck.getBoundingClientRect(),
        signal
      );
    }
  },
});
