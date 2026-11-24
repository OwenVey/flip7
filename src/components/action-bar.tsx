import ArrowLeft from "@lucide/solid/icons/arrow-left";
import ArrowRight from "@lucide/solid/icons/arrow-right";
import Hand from "@lucide/solid/icons/hand";
import RotateCcw from "@lucide/solid/icons/rotate-ccw";
import SquarePlus from "@lucide/solid/icons/square-plus";
import Trophy from "@lucide/solid/icons/trophy";
import { Button } from "@ui-sdk/solid/button";
import { createEffect, createMemo, For, Match, Show, Switch } from "solid-js";
import type { ParentProps } from "solid-js";

import type { HeldCard } from "../game/engine";
import type { RoomView } from "../game/protocol";
import { pop } from "../lib/table-motion";
import { samePrompt, tablePrompt } from "../lib/table-prompt";
import type { PromptPlayback } from "../lib/table-prompt";
import CardBackMark from "./card-back-mark";
import PlayingCard from "./playing-card";
import ScrollFade from "./scroll-fade";
import { nameOf } from "./table-common";
import type { TableProps } from "./table-common";

const sameHeldCards = (a: HeldCard[], b: HeldCard[]) =>
  a.length === b.length &&
  a.every((entry, index) => entry.card.id === b[index]?.card.id);

const FitLabel = (props: { long: string; short: string }) => (
  <>
    <span class="label-long">{props.long}</span>
    <span class="label-short" aria-hidden="true">
      {props.short}
    </span>
  </>
);

const LOW_DECK = 15;

const deckStack = (count: number) => {
  if (count === 0) {
    return "empty";
  }

  return count <= LOW_DECK ? "low" : "full";
};

const HeldPile = (props: { room: RoomView }) => {
  const held = createMemo(() => props.room.held, { equals: sameHeldCards });

  const owners = () =>
    [...new Set(held().map((entry) => entry.ownerId))]
      .map((id) => nameOf(props.room, id))
      .join(" and ");

  return (
    <Show when={held().length > 0}>
      <div class="held-pile" data-held="">
        <span class="held-pile-label" aria-hidden="true">
          Held
        </span>
        <ul
          class="held-pile-cards"
          aria-label={`Held for ${owners()} until the Flip Three ends`}
        >
          <For each={held()} keyed={(entry) => entry.card.id}>
            {(entry) => <PlayingCard card={entry().card} size="mini" />}
          </For>
        </ul>
      </div>
    </Show>
  );
};

const Deck = (props: { count: number }) => {
  let counter: HTMLSpanElement | undefined;

  createEffect(
    () => props.count,
    (count, previous) => {
      if (previous !== undefined && count !== previous) {
        pop(counter);
      }
    }
  );

  return (
    <div class="deck" data-deck="">
      <span
        class="card-back"
        data-stack={deckStack(props.count)}
        data-empty={props.count === 0 ? "" : undefined}
        aria-hidden="true"
      >
        <CardBackMark />
      </span>
      <span
        class="deck-count"
        ref={(element) => {
          counter = element;
        }}
      >
        {props.count}
        <span class="sr-only"> cards left in the deck</span>
      </span>
    </div>
  );
};

const ActionButtons = (props: ParentProps) => (
  <ScrollFade
    class="action-buttons"
    viewportClass="action-buttons-scroll"
    horizontal
  >
    <div class="action-button-items">{props.children}</div>
  </ScrollFade>
);

const pointsLabel = (points: number) =>
  points === 1 ? "1 point" : `${points} points`;

const ActionBar = (
  props: Pick<TableProps, "room" | "playerId" | "send" | "actionsDisabled"> & {
    playback: PromptPlayback;
  }
) => {
  const prompt = createMemo(
    () => tablePrompt(props.room, props.playerId, props.playback),
    { equals: samePrompt }
  );

  const kind = createMemo(() => prompt().controls.kind);

  const turn = () => {
    const { controls } = prompt();

    return controls.kind === "turn" ? controls : null;
  };

  const offlineTurn = () => {
    const controls = turn();

    return controls?.for === undefined ? null : controls;
  };

  const myTurn = () => kind() === "turn" && offlineTurn() === null;

  const canStart = () => {
    const { controls } = prompt();

    return controls.kind === "gameOver" && controls.canStart;
  };

  const waitText = () => {
    const { controls } = prompt();

    return controls.kind === "waitForHost" ? controls.text : "";
  };

  return (
    <section
      class="action-bar"
      data-action-bar=""
      aria-label={prompt().yours ? "Your move" : "Game status"}
      data-turn={myTurn() ? "" : undefined}
    >
      <ScrollFade viewportClass="action-bar-scroll">
        <div class="action-bar-content">
          <Show
            when={props.room.phase === "gameOver" && !props.playback.dealing}
            fallback={<Deck count={props.room.deckCount} />}
          >
            <span class="action-bar-trophy" aria-hidden="true">
              <Trophy />
            </span>
          </Show>
          <HeldPile room={props.room} />
          <Show when={prompt().card}>
            {(card) => (
              <ul
                class="dealt-action-card"
                data-choice-card=""
                aria-hidden="true"
              >
                <PlayingCard card={card()} size="mini" />
              </ul>
            )}
          </Show>
          <Show when={prompt().headline}>
            {(headline) => (
              <p
                class="headline"
                data-winner-headline={prompt().winner ? "" : undefined}
              >
                {headline()}
                <Show when={prompt().note}>
                  {(note) => (
                    <>
                      {" "}
                      <span class="muted">
                        <span aria-hidden="true">· </span>
                        {note()}
                      </span>
                    </>
                  )}
                </Show>
              </p>
            )}
          </Show>
          <Switch>
            <Match when={kind() === "waitForHost"}>
              <p class="muted">{waitText()}</p>
            </Match>
            <Match when={kind() === "gameOver"}>
              <ActionButtons>
                <Button
                  data-size="lg"
                  disabled={props.actionsDisabled}
                  data-variant={canStart() ? undefined : "solid"}
                  onClick={async () => await props.send({ type: "lobby" })}
                >
                  <ArrowLeft size={16} />
                  Back to lobby
                </Button>
                <Show when={canStart()}>
                  <Button
                    data-size="lg"
                    disabled={props.actionsDisabled}
                    data-variant="solid"
                    data-game-tap=""
                    onClick={async () => await props.send({ type: "start" })}
                  >
                    <RotateCcw size={16} />
                    Play again
                  </Button>
                </Show>
              </ActionButtons>
            </Match>
            <Match when={kind() === "nextRound"}>
              <ActionButtons>
                <Button
                  data-size="lg"
                  disabled={props.actionsDisabled}
                  data-variant="solid"
                  data-game-tap=""
                  onClick={async () => await props.send({ type: "nextRound" })}
                >
                  <ArrowRight size={16} />
                  Start next round
                </Button>
              </ActionButtons>
            </Match>
            <Match when={myTurn()}>
              <ActionButtons>
                <Button
                  data-size="lg"
                  disabled={props.actionsDisabled}
                  data-variant="solid"
                  data-game-tap=""
                  onClick={() => {
                    void props.send({ type: "hit" });
                  }}
                >
                  <SquarePlus size={16} />
                  Hit
                </Button>
                <Show when={turn()?.canStay}>
                  <Button
                    data-size="lg"
                    disabled={props.actionsDisabled}
                    data-game-tap=""
                    onClick={() => {
                      void props.send({ type: "stay" });
                    }}
                  >
                    <Hand size={16} />
                    Stay
                  </Button>
                </Show>
              </ActionButtons>
            </Match>
            <Match when={offlineTurn()}>
              {(offline) => (
                <ActionButtons>
                  <Button
                    data-size="lg"
                    disabled={props.actionsDisabled}
                    data-variant="solid"
                    aria-label={`Hit for ${offline().for?.name}`}
                    data-game-tap=""
                    onClick={async () =>
                      await props.send({
                        forId: offline().for?.id,
                        type: "hit",
                      })
                    }
                  >
                    <SquarePlus size={16} />
                    Hit
                  </Button>
                  <Show when={offline().canStay}>
                    <Button
                      data-size="lg"
                      disabled={props.actionsDisabled}
                      aria-label={`Stay for ${offline().for?.name} with ${pointsLabel(offline().roundPoints)}`}
                      data-game-tap=""
                      onClick={async () =>
                        await props.send({
                          forId: offline().for?.id,
                          type: "stay",
                        })
                      }
                    >
                      <Hand size={16} />
                      <FitLabel
                        long={`Stay · ${pointsLabel(offline().roundPoints)}`}
                        short="Stay"
                      />
                    </Button>
                  </Show>
                </ActionButtons>
              )}
            </Match>
          </Switch>
        </div>
      </ScrollFade>
    </section>
  );
};

export default ActionBar;
