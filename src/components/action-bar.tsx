import ArrowLeft from "@lucide/solid/icons/arrow-left";
import ArrowRight from "@lucide/solid/icons/arrow-right";
import Hand from "@lucide/solid/icons/hand";
import RotateCcw from "@lucide/solid/icons/rotate-ccw";
import SquarePlus from "@lucide/solid/icons/square-plus";
import Trophy from "@lucide/solid/icons/trophy";
import { Button } from "@ui-sdk/solid/button";
import { createEffect, createMemo, For, Match, Show, Switch } from "solid-js";
import type { ParentProps } from "solid-js";

import { cardLabel } from "../game/cards";
import { FLIP_THREE_COUNT } from "../game/engine";
import type { ActionCardChoice, HeldCard, Player } from "../game/engine";
import type { RoomView } from "../game/protocol";
import type { DealStep } from "../lib/deal-plan";
import { hostName } from "../lib/host";
import { rankPlayers } from "../lib/standings";
import { pop } from "../lib/table-motion";
import CardBackMark from "./card-back-mark";
import PlayingCard from "./playing-card";
import ScrollFade from "./scroll-fade";
import { nameOf, pointsOf, stepPlayerId } from "./table-common";
import type {
  DealProps,
  MoveControls,
  RoundPointsByPlayer,
  TableProps,
} from "./table-common";

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

const playPaused = (room: RoomView) =>
  !room.players.some((player) => player.connected && !player.bot);

const ActionCardPrompt = (
  props: Pick<TableProps, "room"> &
    Pick<MoveControls, "moves"> & {
      choice: ActionCardChoice;
      dealingLabel?: string;
    }
) => (
  <>
    <ul class="dealt-action-card" data-choice-card="" aria-hidden="true">
      <PlayingCard card={props.choice.card} size="mini" />
    </ul>
    <Show
      when={props.dealingLabel}
      fallback={
        <Show
          when={props.moves.choice}
          fallback={
            <p class="headline">
              {nameOf(props.room, props.choice.chooserId)}{" "}
              <Show
                when={props.moves.waitingOn?.offline}
                fallback={`is choosing who receives ${cardLabel(props.choice.card)}.`}
              >
                is offline.{" "}
                <span class="muted">
                  ·{" "}
                  {playPaused(props.room)
                    ? "Play resumes when a player reconnects."
                    : `The game will play ${cardLabel(props.choice.card)} for them soon.`}
                </span>
              </Show>
            </p>
          }
        >
          {(move) => (
            <Show
              when={move().forId === undefined}
              fallback={
                <p class="headline">
                  {nameOf(props.room, props.choice.chooserId)} is offline.{" "}
                  <span class="muted">
                    · Pick who gets their {cardLabel(props.choice.card)}, or the
                    game will play it for them soon.
                  </span>
                </p>
              }
            >
              <p class="headline">
                Who gets your {cardLabel(props.choice.card)}?{" "}
                <span class="muted">Tap a player</span>
              </p>
            </Show>
          )}
        </Show>
      }
    >
      <p class="headline">{props.dealingLabel}</p>
    </Show>
  </>
);

const flipLabel = (
  flip: NonNullable<DealStep["flip"]>,
  isMe: boolean,
  name: string
) => {
  if (flip.index === 0) {
    return isMe ? "Flip Three on you!" : `Flip Three on ${name}!`;
  }

  return `Flip Three · ${isMe ? "you flip" : `${name} flips`} ${flip.index} of ${flip.total}`;
};

const discardLabel = (step: DealStep, isMe: boolean, name: string) => {
  if (step.partnerId !== null) {
    return isMe ? "Second Chance saves you!" : `Second Chance saves ${name}!`;
  }

  return `${cardLabel(step.card)} is discarded`;
};

const LOW_DECK = 15;

const deckStack = (count: number) => {
  if (count === 0) {
    return "empty";
  }

  return count <= LOW_DECK ? "low" : "full";
};

const automaticTurnLabel = (canStay: boolean) =>
  `The game will ${canStay ? "Stay" : "Hit"} for them soon.`;

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

const OfflineTurn = (
  props: Pick<TableProps, "room" | "send" | "actionsDisabled"> & {
    playerId: string;
    canStay: boolean;
    roundPoints: number;
  }
) => {
  const player = () =>
    props.room.players.find((candidate) => candidate.id === props.playerId);

  const name = () => player()?.name ?? "Someone";

  const bankedPoints = () =>
    props.roundPoints === 1 ? "1 point" : `${props.roundPoints} points`;

  return (
    <>
      <p class="headline">
        {name()} is offline{" "}
        <span class="muted">
          · Play for them, or the game will {props.canStay ? "Stay" : "Hit"}{" "}
          soon
        </span>
      </p>
      <ActionButtons>
        <Button
          data-size="lg"
          disabled={props.actionsDisabled}
          data-variant="solid"
          aria-label={`Hit for ${name()}`}
          data-game-tap=""
          onClick={async () =>
            await props.send({ forId: props.playerId, type: "hit" })
          }
        >
          <SquarePlus size={16} />
          Hit
        </Button>
        <Show when={props.canStay}>
          <Button
            data-size="lg"
            disabled={props.actionsDisabled}
            aria-label={`Stay for ${name()} with ${bankedPoints()}`}
            data-game-tap=""
            onClick={async () =>
              await props.send({ forId: props.playerId, type: "stay" })
            }
          >
            <Hand size={16} />
            <FitLabel long={`Stay · ${bankedPoints()}`} short="Stay" />
          </Button>
        </Show>
      </ActionButtons>
    </>
  );
};

const previousScore = (player: Player) =>
  player.score - (player.lastRound?.total ?? 0);

const roundEndHeadline = (room: RoomView) => {
  const flippedSeven = room.players.find(
    (player) => player.status === "flipSeven"
  );

  if (flippedSeven) {
    return `${flippedSeven.name} Flipped 7! +${flippedSeven.lastRound?.total ?? 0}`;
  }

  const [first, second] = rankPlayers(room.players);

  if (
    first !== undefined &&
    second !== undefined &&
    first.player.score > second.player.score
  ) {
    const tookLead = room.players.some(
      (player) =>
        player.id !== first.player.id &&
        previousScore(player) >= previousScore(first.player)
    );

    if (tookLead) {
      return `${first.player.name} takes the lead`;
    }
  }

  return `End of round ${room.round}`;
};

const ActionBar = (
  props: TableProps &
    DealProps &
    RoundPointsByPlayer &
    Pick<MoveControls, "moves">
) => {
  const nextRound = async () => await props.send({ type: "nextRound" });

  const myTurn = () => {
    const { turn } = props.moves;

    return turn !== null && turn.forId === undefined && props.dealing !== true;
  };

  const actionBarLabel = () => {
    const { choice } = props.moves;

    const myChoice =
      choice !== null && choice.forId === undefined && props.dealing !== true;

    return myTurn() || myChoice ? "Your move" : "Game status";
  };

  const dealingLabel = () => {
    const step = props.dealStep ?? null;

    const target =
      step?.to.kind === "choice"
        ? (props.room.choice?.chooserId ?? null)
        : stepPlayerId(step);

    if (step === null || target === null) {
      return "Dealing…";
    }

    const isMe = target === props.playerId;
    const name = nameOf(props.room, target);

    if (step.flip) {
      return flipLabel(step.flip, isMe, name);
    }

    if (step.to.kind === "played") {
      return flipLabel({ index: 0, total: FLIP_THREE_COUNT }, isMe, name);
    }

    if (step.to.kind === "discard") {
      return discardLabel(step, isMe, name);
    }

    if (step.from === "held") {
      return `${cardLabel(step.card)} comes into play…`;
    }

    if (step.from === "choice") {
      return `${cardLabel(step.card)} goes to ${isMe ? "you" : name}…`;
    }

    if (step.hit) {
      return isMe ? "You hit…" : `${name} hits…`;
    }

    return isMe ? "Dealing to you…" : `Dealing to ${name}…`;
  };

  const iCanStay = () => props.moves.turn?.canStay === true;

  const myRound = () => pointsOf(props.roundPoints, props.playerId);

  const winners = () =>
    props.room.winnerIds.map((id) => nameOf(props.room, id)).join(" and ");

  const offlineTurn = () => {
    const { turn } = props.moves;

    return turn?.forId === undefined
      ? null
      : { canStay: turn.canStay, playerId: turn.forId };
  };

  return (
    <section
      class="action-bar"
      data-action-bar=""
      aria-label={actionBarLabel()}
      data-turn={myTurn() ? "" : undefined}
    >
      <ScrollFade viewportClass="action-bar-scroll">
        <div class="action-bar-content">
          <Show
            when={props.room.phase === "gameOver" && props.dealing !== true}
            fallback={<Deck count={props.room.deckCount} />}
          >
            <span class="action-bar-trophy" aria-hidden="true">
              <Trophy />
            </span>
          </Show>
          <HeldPile room={props.room} />
          <Switch>
            <Match when={props.room.phase === "gameOver"}>
              <p class="headline" data-winner-headline="">
                {winners()} wins!
              </p>
              <Show
                when={props.moves.host.lobby}
                fallback={
                  <p class="muted">
                    Waiting for {hostName(props.room)} to play again or head
                    back to the lobby.
                  </p>
                }
              >
                <ActionButtons>
                  <Button
                    data-size="lg"
                    disabled={props.actionsDisabled}
                    data-variant={props.moves.host.start ? undefined : "solid"}
                    onClick={async () => await props.send({ type: "lobby" })}
                  >
                    <ArrowLeft size={16} />
                    Back to lobby
                  </Button>
                  <Show when={props.moves.host.start}>
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
              </Show>
            </Match>
            <Match when={props.room.phase === "roundOver"}>
              <p class="headline">{roundEndHeadline(props.room)}</p>
              <Show
                when={props.moves.host.nextRound}
                fallback={
                  <p class="muted">
                    Waiting for {hostName(props.room)} to start the next round.
                  </p>
                }
              >
                <ActionButtons>
                  <Button
                    data-size="lg"
                    disabled={props.actionsDisabled}
                    data-variant="solid"
                    data-game-tap=""
                    onClick={nextRound}
                  >
                    <ArrowRight size={16} />
                    Start next round
                  </Button>
                </ActionButtons>
              </Show>
            </Match>
            <Match when={props.room.choice}>
              {(choice) => (
                <ActionCardPrompt
                  choice={choice()}
                  dealingLabel={
                    props.dealing === true ? dealingLabel() : undefined
                  }
                  moves={props.moves}
                  room={props.room}
                />
              )}
            </Match>
            <Match when={props.dealing}>
              <p class="headline">{dealingLabel()}</p>
            </Match>
            <Match when={myTurn()}>
              <p class="headline">
                Your turn{" "}
                <span class="muted">
                  ·{" "}
                  {iCanStay()
                    ? `${myRound()} points this round`
                    : "Hit for a card before you can stay"}
                </span>
              </p>
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
                <Show when={iCanStay()}>
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
              {(turn) => (
                <OfflineTurn
                  playerId={turn().playerId}
                  canStay={turn().canStay}
                  roundPoints={pointsOf(props.roundPoints, turn().playerId)}
                  room={props.room}
                  send={props.send}
                  actionsDisabled={props.actionsDisabled}
                />
              )}
            </Match>
            <Match when={playPaused(props.room) && props.moves.waitingOn}>
              {(waiting) => (
                <p class="headline">
                  Waiting on {nameOf(props.room, waiting().playerId)}{" "}
                  <span class="muted">
                    · Play resumes when a player reconnects.
                  </span>
                </p>
              )}
            </Match>
            <Match when={props.room.turnId}>
              {(turnId) => (
                <p class="headline">
                  {nameOf(props.room, turnId())}{" "}
                  <Show
                    when={props.moves.waitingOn?.offline}
                    fallback="is deciding…"
                  >
                    is offline.{" "}
                    <span class="muted">
                      ·{" "}
                      {automaticTurnLabel(
                        props.moves.waitingOn?.canStay === true
                      )}
                    </span>
                  </Show>
                </p>
              )}
            </Match>
          </Switch>
        </div>
      </ScrollFade>
    </section>
  );
};

export default ActionBar;
