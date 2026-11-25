import X from "@lucide/solid/icons/x";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/solid/dialog";
import { For } from "solid-js";
import type { ParentProps } from "solid-js";

import { FLIP_SEVEN_BONUS } from "../game/cards";
import type { Card } from "../game/cards";
import type { TargetScore } from "../game/settings";
import PlayingCard from "./playing-card";
import ScrollFade from "./scroll-fade";
import Tooltip from "./tooltip";

const freeze: Card = { id: 0, kind: "freeze" };
const flipThree: Card = { id: 1, kind: "flipThree" };
const secondChance: Card = { id: 2, kind: "secondChance" };
const double: Card = { id: 3, kind: "double" };
const plusFour: Card = { id: 4, kind: "modifier", value: 4 };

const CardRule = (props: ParentProps<{ cards?: Card[] }>) => (
  <li class="rules-card-rule">
    <ul class="rules-cards" aria-hidden="true">
      <For each={props.cards ?? []}>
        {(card) => <PlayingCard card={card} size="mini" />}
      </For>
    </ul>
    <p>{props.children}</p>
  </li>
);

export default function RulesDialog(props: {
  targetScore: TargetScore;
  label?: string;
  size?: "sm";
}) {
  return (
    <Dialog presentation="auto">
      <DialogTrigger data-size={props.size}>
        {props.label ?? "Rules"}
      </DialogTrigger>
      <DialogContent class="rules-dialog" initialFocus="content">
        <header class="table-sheet-header">
          <DialogTitle>How to play</DialogTitle>
          <Tooltip
            content="Close rules"
            type="label"
            trigger={(hint) => (
              <DialogClose
                {...hint}
                aria-label="Close rules"
                data-size="sm"
                data-icon=""
              />
            )}
          >
            <X size={16} aria-hidden="true" />
          </Tooltip>
        </header>
        <ScrollFade viewportClass="table-sheet-body" label="Game rules">
          <div class="rules-sections">
            <section>
              <h3>Your turn</h3>
              <ul class="rules-list">
                <li>
                  <strong>Hit</strong> to take another card, or{" "}
                  <strong>Stay</strong> to bank your points and sit out the
                  round. You need a card in front of you to Stay.
                </li>
                <li>
                  A duplicate Number card busts you, and you score zero for the
                  round.
                </li>
                <li>
                  <strong>Flip 7</strong> unique Number cards to earn{" "}
                  {FLIP_SEVEN_BONUS} bonus points and end the round for
                  everyone.
                </li>
                <li>
                  When the deck runs out, the discard pile is shuffled into a
                  new deck. If both are empty, the round ends and everyone who
                  hasn't busted scores what they hold.
                </li>
              </ul>
            </section>
            <section>
              <h3>Action cards</h3>
              <p>
                Play Freeze and Flip Three on any active player, including
                yourself.
              </p>
              <ul class="rules-card-list">
                <CardRule cards={[freeze]}>
                  <strong>Freeze</strong>: the player banks their points and
                  exits the round.
                </CardRule>
                <CardRule cards={[flipThree]}>
                  <strong>Flip Three</strong>: the player takes up to three
                  cards in a row. A Freeze or Flip Three drawn meanwhile is
                  held. If they survive all three, they assign each held card in
                  the order drawn. A held card whose target is no longer active
                  is discarded.
                </CardRule>
                <CardRule cards={[secondChance]}>
                  <strong>Second Chance</strong>: discard it with your next
                  duplicate Number card and keep playing. If you already have
                  one, give the extra to an active player without one, or
                  discard it if nobody can take it.
                </CardRule>
              </ul>
            </section>
            <section>
              <h3>Scoring</h3>
              <ul class="rules-card-list">
                <CardRule cards={[double, plusFour]}>
                  Add up your Number cards and apply <strong>×2</strong> if you
                  have it. Then add any other <strong>Score Modifier</strong>{" "}
                  points and the Flip 7 bonus.
                </CardRule>
                <CardRule>
                  At the end of a round, the sole leader wins if they have at
                  least {props.targetScore} points. A tie for first plays on.
                </CardRule>
              </ul>
            </section>
          </div>
        </ScrollFade>
      </DialogContent>
    </Dialog>
  );
}
