import { For, Show } from "solid-js";
import type { ParentProps } from "solid-js";

import { FLIP_SEVEN_BONUS } from "../game/cards";
import type { Card } from "../game/cards";
import { DEFAULT_SETTINGS } from "../game/settings";
import CardBackMark from "./card-back-mark";
import PlayingCard from "./playing-card";
import RulesDialog from "./rules-dialog";

const number = (id: number, value: number) =>
  ({ id, kind: "number", value }) satisfies Card;

const Step = (
  props: ParentProps<{ cards: Card[]; bust?: boolean; draw?: boolean }>
) => (
  <li class="rules-card-rule">
    <ul class="rules-cards" aria-hidden="true">
      <For each={props.cards}>
        {(card, index) => (
          <PlayingCard
            card={card}
            size="mini"
            bust={props.bust === true && index() === props.cards.length - 1}
          />
        )}
      </For>
      <Show when={props.draw}>
        <li class="card-back">
          <CardBackMark />
        </li>
      </Show>
    </ul>
    <p>{props.children}</p>
  </li>
);

/** The home page's second panel: the rules at a glance. */
export default function HomeGuide() {
  return (
    <section class="panel home-guide" aria-labelledby="steps-heading">
      <h2 id="steps-heading">How it plays</h2>
      <div class="home-steps">
        <ul class="rules-card-list">
          <Step cards={[number(1, 5), number(2, 9)]} draw>
            <strong>Hit</strong> to flip another card, or <strong>Stay</strong>{" "}
            to bank your points for the round.
          </Step>
          <Step cards={[number(3, 8), number(4, 8)]} bust>
            Flip a number you already have and you <strong>bust</strong>,
            scoring nothing.
          </Step>
          <Step cards={[number(5, 7)]}>
            <strong>Flip 7</strong> different numbers for a {FLIP_SEVEN_BONUS}
            -point bonus.
          </Step>
          <Step
            cards={[
              { id: 6, kind: "freeze" },
              { id: 7, kind: "flipThree" },
              { id: 8, kind: "secondChance" },
            ]}
          >
            <strong>Action cards</strong> freeze a rival, force three flips, or
            save you from a bust.
          </Step>
        </ul>
        <p class="home-steps-goal">
          <span>
            First to <strong>{DEFAULT_SETTINGS.targetScore}</strong> points
            wins.
          </span>
          <RulesDialog
            targetScore={DEFAULT_SETTINGS.targetScore}
            label="Full rules"
            variant="quiet"
          />
        </p>
      </div>
    </section>
  );
}
