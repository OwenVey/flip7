import PlayingCardsFan from "@lucide/solid/icons/playing-cards-fan";
import ShieldCheck from "@lucide/solid/icons/shield-check";
import Snowflake from "@lucide/solid/icons/snowflake";
import { Match, Show, Switch } from "solid-js";

import {
  ADDITIVE_MODIFIER_KIND,
  cardLabel,
  isActionCard,
  isScoreModifierCard,
} from "../game/cards";
import type { Card } from "../game/cards";

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
      <ShieldCheck class="card-icon" />
    </Match>
  </Switch>
);

export default function PlayingCard(props: { card: Card; bust?: boolean }) {
  return (
    <li
      class="card"
      data-kind={props.card.kind}
      data-number={props.card.kind === "number" ? props.card.value : undefined}
      data-score-modifier={isScoreModifierCard(props.card) ? "" : undefined}
      data-bust={props.bust === true ? "" : undefined}
      aria-label={cardName(props.card, props.bust === true)}
      title={CARD_HINTS[props.card.kind] || undefined}
    >
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
    </li>
  );
}
