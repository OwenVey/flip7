import Heart from "@lucide/solid/icons/heart";
import PlayingCardsFan from "@lucide/solid/icons/playing-cards-fan";
import Snowflake from "@lucide/solid/icons/snowflake";
import { TooltipTrigger } from "@ui-sdk/solid/tooltip";
import { Match, Show, Switch } from "solid-js";

import {
  ADDITIVE_MODIFIER_KIND,
  cardLabel,
  isActionCard,
  isScoreModifierCard,
} from "../game/cards";
import type { Card } from "../game/cards";
import { useCardTooltips } from "./card-tooltips";

const CARD_HINTS = {
  [ADDITIVE_MODIFIER_KIND]: "Score Modifier card that adds the points shown",
  double: "Score Modifier card that doubles the value of your Number cards",
  flipThree: "The receiving player takes the next three cards, one at a time",
  freeze: "The receiving player banks their points and exits the round",
  number: "",
  secondChance: "Discard this card and your next duplicate Number card",
} as const;

const cardName = (card: Card, bust: boolean) => {
  const hint = CARD_HINTS[card.kind];
  const name = hint === "" ? cardLabel(card) : `${cardLabel(card)}: ${hint}`;

  return bust ? `${name}, busted` : name;
};

const ActionIcon = (props: { kind: Card["kind"] }) => (
  <Switch>
    <Match when={props.kind === "freeze"}>
      <Snowflake class="card-icon" />
    </Match>
    <Match when={props.kind === "flipThree"}>
      <PlayingCardsFan class="card-icon" />
    </Match>
    <Match when={props.kind === "secondChance"}>
      <Heart class="card-icon" />
    </Match>
  </Switch>
);

/** How a card is drawn: full size in a hand, or shrunk everywhere smaller. */
export type CardSize = "full" | "mini";

export default function PlayingCard(props: {
  card: Card;
  size?: CardSize;
  bust?: boolean;
  /** The card a bust card duplicates. */
  dupe?: boolean;
}) {
  const tooltips = useCardTooltips();
  const hint = () => CARD_HINTS[props.card.kind];

  const attributes = () => ({
    "aria-label": cardName(props.card, props.bust === true),
    class: "card",
    "data-bust": props.bust === true ? "" : undefined,
    "data-card-id": props.card.id,
    "data-dupe": props.dupe === true ? "" : undefined,
    "data-kind": props.card.kind,
    "data-number": props.card.kind === "number" ? props.card.value : undefined,
    "data-score-modifier": isScoreModifierCard(props.card) ? "" : undefined,
    "data-size": props.size ?? "full",
  });

  const face = () => (
    <>
      <Show when={!isActionCard(props.card)}>
        <span class="card-corner" aria-hidden="true">
          {cardLabel(props.card)}
        </span>
      </Show>
      <span class="card-face">
        <Show when={isActionCard(props.card)}>
          <ActionIcon kind={props.card.kind} />
        </Show>
        <span class="card-label">{cardLabel(props.card)}</span>
      </span>
      <Show when={!isActionCard(props.card)}>
        <span class="card-corner" data-end="" aria-hidden="true">
          {cardLabel(props.card)}
        </span>
      </Show>
    </>
  );

  return (
    <Show
      when={tooltips !== null && hint() !== "" ? tooltips : undefined}
      fallback={<li {...attributes()}>{face()}</li>}
    >
      {(controller) => (
        <TooltipTrigger
          controller={controller()}
          payload={hint()}
          render={(trigger) => <li {...trigger} {...attributes()} />}
        >
          {face()}
        </TooltipTrigger>
      )}
    </Show>
  );
}
