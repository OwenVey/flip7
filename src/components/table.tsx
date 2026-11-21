import ArrowLeft from "@lucide/solid/icons/arrow-left";
import ArrowRight from "@lucide/solid/icons/arrow-right";
import Coins from "@lucide/solid/icons/coins";
import Flame from "@lucide/solid/icons/flame";
import PlayingCardsFan from "@lucide/solid/icons/playing-cards-fan";
import Snowflake from "@lucide/solid/icons/snowflake";
import SquarePlus from "@lucide/solid/icons/square-plus";
import WifiOff from "@lucide/solid/icons/wifi-off";
import { Button } from "@ui-sdk/solid/button";
import { Meter, MeterIndicator, MeterTrack } from "@ui-sdk/solid/meter";
import { createMemo, For, Match, Repeat, Show, Switch } from "solid-js";

import { cardLabel, calculateRoundScore } from "../game/cards";
import {
  blockingPlayerId,
  canStay,
  FLIP_SEVEN_STATUS,
  FLIP_THREE_COUNT,
} from "../game/engine";
import type { ActionCardChoice, HeldCard, RoundStatus } from "../game/engine";
import type { PlayerView, RoomView } from "../game/protocol";
import { createCountUp } from "../lib/count-up";
import type { DealStep } from "../lib/deal-plan";
import type { RoomConnection } from "../lib/room-connection";
import GameLog from "./game-log";
import InviteButton from "./invite-button";
import LeaveRoom from "./leave-room";
import PlayingCard from "./playing-card";
import RemovePlayer from "./remove-player";

const STATUS_LABELS = {
  active: "Active",
  busted: "Busted",
  frozen: "Frozen",
  out: "Sitting out",
  stayed: "Stayed",
  [FLIP_SEVEN_STATUS]: "Flip 7!",
} as const satisfies Record<RoundStatus, string>;

interface TableProps {
  room: RoomView;
  playerId: string;
  send: RoomConnection["send"];
  actionsDisabled?: boolean;
}

interface DealProps {
  /** True while cards are still flying from the deck. */
  dealing?: boolean;
  /** The card being dealt, and where it's going. */
  dealStep?: DealStep | null;
  /** The card in flight, which doesn't count until it lands. */
  incomingCardId?: number | null;
}

interface FlipProgress {
  flipped: number;
  total: number;
  waiting: boolean;
}

const stepPlayerId = (step: DealStep | null | undefined) =>
  step && step.to.kind !== "choice" ? step.to.playerId : null;

const flipProgress = (
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

const sameProgress = (a: FlipProgress | null, b: FlipProgress | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.flipped === b.flipped &&
    a.total === b.total &&
    a.waiting === b.waiting);

const sameHeldCards = (a: HeldCard[], b: HeldCard[]) =>
  a.length === b.length &&
  a.every((entry, index) => entry.card.id === b[index]?.card.id);

const sameCards = <T extends { id: number }>(a: T[], b: T[]) =>
  a.length === b.length && a.every((card, index) => card.id === b[index]?.id);

const FlipTracker = (props: { progress: FlipProgress }) => (
  <span class="flip-run" data-waiting={props.progress.waiting ? "" : undefined}>
    <PlayingCardsFan size={12} aria-hidden="true" />
    Flip Three
    <span class="flip-pips" aria-hidden="true">
      <Repeat count={props.progress.total}>
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
  </span>
);

const currentRoundPoints = (player: PlayerView) =>
  player.status === "busted" ? 0 : calculateRoundScore(player.hand).total;

const nameOf = (room: RoomView, id: string | null) =>
  room.players.find((player) => player.id === id)?.name ?? "Someone";

const isOffline = (room: RoomView, id: string) =>
  room.players.find((player) => player.id === id)?.connected === false;

const canStayById = (room: RoomView, id: string) => {
  const player = room.players.find((candidate) => candidate.id === id);

  return player ? canStay(player) : false;
};

const RoundPlayer = (
  props: TableProps &
    Pick<DealProps, "incomingCardId" | "dealStep"> & {
      player: PlayerView;
    }
) => {
  const held = createMemo(
    () => props.room.held.filter((entry) => entry.ownerId === props.player.id),
    { equals: sameHeldCards }
  );

  const numberCards = createMemo(
    () => props.player.hand.filter((card) => card.kind === "number"),
    { equals: sameCards }
  );

  const extraCards = createMemo(
    () => props.player.hand.filter((card) => card.kind !== "number"),
    { equals: sameCards }
  );

  const bustCard = createMemo(() => props.player.bustCard, {
    equals: (a, b) => a?.id === b?.id,
  });

  const flip = createMemo(
    () => flipProgress(props.room, props.dealStep, props.player.id),
    { equals: sameProgress }
  );

  const isMe = () => props.player.id === props.playerId;
  const isHost = () => props.room.hostId === props.playerId;
  const hasDecision = () => blockingPlayerId(props.room) === props.player.id;
  const isFrozen = () => props.player.status === "frozen";

  const roundResult = () =>
    props.room.phase === "playing" ? null : props.player.lastRound;

  const pendingPoints = createMemo(() =>
    props.room.phase === "playing" && props.player.status !== "out"
      ? currentRoundPoints({
          ...props.player,
          hand: props.player.hand.filter(
            (card) => card.id !== props.incomingCardId
          ),
        })
      : 0
  );

  const roundPoints = () => roundResult()?.total ?? pendingPoints();

  const baseScore = () =>
    props.room.phase === "playing"
      ? props.player.score
      : props.player.score - (roundResult()?.total ?? 0);

  const projectedScore = () => baseScore() + roundPoints();

  const shownBaseScore = createCountUp(baseScore);

  const lostPoints = () =>
    props.room.phase === "playing" && props.player.status === "busted"
      ? calculateRoundScore(props.player.hand).total
      : 0;

  const roundRisk = () => {
    if (roundPoints() <= 0) {
      return "none";
    }

    return props.room.phase === "playing" && props.player.status === "active"
      ? "at-risk"
      : "locked";
  };

  const wouldWin = () => projectedScore() >= props.room.targetScore;

  const scorePercent = (score: number) =>
    `${Math.min(100, (score / props.room.targetScore) * 100)}%`;

  const scoreDetails = () => {
    const details: string[] = [];

    if (roundPoints() > 0) {
      details.push(`${roundPoints()} this round`);
    }

    if (wouldWin()) {
      details.push("enough to win");
    }

    return details;
  };

  const decisionLabel = () => {
    if (props.room.choice) {
      return "Choosing…";
    }

    return isMe() ? "Your turn" : "Thinking…";
  };

  return (
    <article
      class="seat"
      data-status={
        props.player.status === FLIP_SEVEN_STATUS
          ? "flipSeven"
          : props.player.status
      }
      data-seat={props.player.id}
      data-flipping={flip()?.waiting === false ? "" : undefined}
      data-turn={hasDecision() ? "" : undefined}
      data-me={isMe() ? "" : undefined}
      data-offline={props.player.connected ? undefined : ""}
      aria-label={`${props.player.name}, ${props.player.score} points`}
    >
      <header class="seat-header">
        <div class="seat-name">
          <strong>{props.player.name}</strong>
          <Show when={isMe()}>
            <span class="badge">You</span>
          </Show>
          <Show when={props.room.dealerId === props.player.id}>
            <span class="dealer-chip" title="Dealer">
              <span aria-hidden="true">D</span>
              <span class="sr-only">Dealer</span>
            </span>
          </Show>
          <Show when={!props.player.connected}>
            <span class="badge" data-tone="danger">
              <WifiOff size={12} aria-hidden="true" />
              Offline
            </span>
          </Show>
        </div>
        <Show when={isHost() && !isMe()}>
          <RemovePlayer
            disabled={props.actionsDisabled}
            name={props.player.name}
            onRemove={() => {
              void props.send({ playerId: props.player.id, type: "kick" });
            }}
          />
        </Show>
      </header>
      <div class="seat-meta">
        <Show when={hasDecision()}>
          <span class="badge" data-tone="turn">
            {decisionLabel()}
          </span>
        </Show>
        <Show when={props.player.status !== "active"}>
          <span class="status-pill">
            <Show when={isFrozen()}>
              <Snowflake size={12} aria-hidden="true" />
            </Show>
            {STATUS_LABELS[props.player.status]}
          </span>
        </Show>
        <Show when={props.player.status === "out"}>
          <span class="muted">Joins next round</span>
        </Show>
        <Show when={flip()}>
          {(progress) => <FlipTracker progress={progress()} />}
        </Show>
      </div>
      <ul class="hand" aria-label={`${props.player.name}'s cards`}>
        <For each={numberCards()} keyed={(card) => card.id}>
          {(card) => <PlayingCard card={card()} />}
        </For>
        <Show when={bustCard()}>
          {(card) => <PlayingCard card={card()} bust />}
        </Show>
      </ul>
      <ul
        class="seat-extras"
        aria-label={`${props.player.name}'s modifier and Second Chance cards`}
      >
        <For each={extraCards()} keyed={(card) => card.id}>
          {(card) => <PlayingCard card={card()} />}
        </For>
      </ul>
      <Show when={held().length > 0}>
        <div class="held" data-held="">
          <p class="held-label">Waiting to play</p>
          <ul
            class="held-cards"
            aria-label={`${props.player.name}'s held action cards`}
          >
            <For each={held()} keyed={(entry) => entry.card.id}>
              {(entry) => <PlayingCard card={entry().card} />}
            </For>
          </ul>
        </div>
      </Show>
      <Show when={isFrozen()}>
        <div class="frost" aria-hidden="true">
          <Snowflake class="frost-burst" />
          <Snowflake class="frost-flake" />
          <Snowflake class="frost-flake" />
          <Snowflake class="frost-flake" />
        </div>
      </Show>
      <Meter
        aria-label="Total score"
        class="seat-meter"
        value={props.player.score}
        max={props.room.targetScore}
        data-round={roundRisk()}
        data-winning={wouldWin() ? "" : undefined}
        style={{
          "--lost-end": scorePercent(baseScore() + lostPoints()),
          "--projected-score": scorePercent(projectedScore()),
          "--round-start": scorePercent(baseScore()),
        }}
        getValueLabel={(value, details) =>
          [`${value} of ${details.max} points`, ...scoreDetails()].join(", ")
        }
      >
        <div class="seat-scores" aria-hidden="true">
          <span class="seat-score" data-banked="">
            {shownBaseScore()}
          </span>
          <Show when={roundPoints() > 0}>
            <span class="seat-score" data-projected="">
              +{roundPoints()}
            </span>
          </Show>
          <span class="seat-score" data-goal="">
            {props.room.targetScore}
          </span>
        </div>
        <MeterTrack>
          <MeterIndicator />
          <span class="meter-round" />
          <Show when={lostPoints() > 0}>
            <span class="meter-lost" />
          </Show>
        </MeterTrack>
      </Meter>
    </article>
  );
};

const ActionCardPrompt = (props: TableProps & { choice: ActionCardChoice }) => {
  const verb = () => {
    if (props.choice.card.kind === "freeze") {
      return "Freeze";
    }

    if (props.choice.card.kind === "flipThree") {
      return "Play Flip Three on";
    }

    return "Give Second Chance to";
  };

  const targetLabel = (targetId: string, capitalized = false) => {
    if (targetId !== props.playerId) {
      return nameOf(props.room, targetId);
    }

    return capitalized ? "Yourself" : "yourself";
  };

  return (
    <>
      <ul class="dealt-action-card" data-choice-card="" aria-hidden="true">
        <PlayingCard card={props.choice.card} />
      </ul>
      <Show
        when={props.choice.chooserId === props.playerId}
        fallback={
          <p class="headline">
            {nameOf(props.room, props.choice.chooserId)} is choosing who
            receives {cardLabel(props.choice.card)}.
            <Show when={isOffline(props.room, props.choice.chooserId)}>
              <span class="muted">
                {" "}
                · Offline, so it will be played for them soon.
              </span>
            </Show>
          </p>
        }
      >
        <p class="headline">{verb()}…</p>
        <div class="action-buttons">
          <For each={props.choice.options}>
            {(targetId) => (
              <Button
                disabled={props.actionsDisabled}
                data-variant={targetId === props.playerId ? undefined : "solid"}
                aria-label={`${verb()} ${targetLabel(targetId)}`}
                onClick={async () =>
                  await props.send({ targetId, type: "choose" })
                }
              >
                {targetLabel(targetId, true)}
              </Button>
            )}
          </For>
        </div>
      </Show>
    </>
  );
};

const Leaderboard = (props: Pick<TableProps, "room" | "playerId">) => {
  const ranked = createMemo(() => {
    const players = props.room.players.toSorted((a, b) => b.score - a.score);
    let rank = 1;

    return players.map((player, index) => {
      if (index > 0 && player.score !== players[index - 1]?.score) {
        rank = index + 1;
      }

      return { player, rank };
    });
  });

  const roundScored = () =>
    props.room.phase === "roundOver" || props.room.phase === "gameOver";

  return (
    <section class="panel">
      <h2 id="leaderboard-title">Leaderboard</h2>
      <table class="leaderboard" aria-labelledby="leaderboard-title">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Player</th>
            <Show when={roundScored()}>
              <th scope="col">Round</th>
            </Show>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          <For each={ranked()} keyed={(entry) => entry.player.id}>
            {(entry) => (
              <tr
                data-winner={
                  props.room.winnerIds.includes(entry().player.id)
                    ? ""
                    : undefined
                }
              >
                <td>{entry().rank}</td>
                <th scope="row">
                  {entry().player.name}
                  <Show when={entry().player.id === props.playerId}>
                    {" "}
                    <span class="badge">You</span>
                  </Show>
                </th>
                <Show when={roundScored()}>
                  <td class="muted">+{entry().player.lastRound?.total ?? 0}</td>
                </Show>
                <td class="leaderboard-total">{entry().player.score}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </section>
  );
};

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

const Deck = (props: { count: number }) => (
  <div class="deck" data-deck="">
    <span
      class="card-back"
      data-empty={props.count === 0 ? "" : undefined}
      aria-hidden="true"
    >
      <Flame />
    </span>
    <span class="deck-count">
      {props.count}
      <span class="sr-only"> cards left in the deck</span>
    </span>
  </div>
);

const ActionBar = (props: TableProps & DealProps) => {
  const isHost = () => props.room.hostId === props.playerId;

  const me = () =>
    props.room.players.find((player) => player.id === props.playerId);

  const myTurn = () =>
    props.room.turnId === props.playerId &&
    props.room.choice === null &&
    props.dealing !== true;

  const dealingLabel = () => {
    const step = props.dealStep ?? null;
    const target = stepPlayerId(step);

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

    return isMe ? "Dealing to you…" : `Dealing to ${name}…`;
  };

  const iCanStay = () => {
    const player = me();

    return player ? canStay(player) : false;
  };

  const myRound = () => {
    const player = me();

    return player ? currentRoundPoints(player) : 0;
  };

  const winners = () =>
    props.room.winnerIds.map((id) => nameOf(props.room, id)).join(" and ");

  return (
    <section
      class="action-bar"
      aria-label="Your move"
      data-turn={myTurn() ? "" : undefined}
    >
      <Deck count={props.room.deckCount} />
      <Switch>
        <Match when={props.room.phase === "gameOver"}>
          <p class="headline">{winners()} wins!</p>
          <Show
            when={isHost()}
            fallback={<p class="muted">Waiting for the host.</p>}
          >
            <div class="action-buttons">
              <Button
                disabled={props.actionsDisabled}
                data-variant="solid"
                onClick={async () => await props.send({ type: "lobby" })}
              >
                <ArrowLeft size={16} />
                Back to lobby
              </Button>
            </div>
          </Show>
        </Match>
        <Match when={props.room.phase === "roundOver"}>
          <p class="headline">End of round {props.room.round}</p>
          <Show
            when={isHost()}
            fallback={
              <p class="muted">Waiting for the host to start the next round.</p>
            }
          >
            <div class="action-buttons">
              <Button
                disabled={props.actionsDisabled}
                data-variant="solid"
                onClick={async () => await props.send({ type: "nextRound" })}
              >
                <ArrowRight size={16} />
                Start next round
              </Button>
            </div>
          </Show>
        </Match>
        <Match when={props.room.choice}>
          {(choice) => (
            <ActionCardPrompt
              choice={choice()}
              room={props.room}
              playerId={props.playerId}
              send={props.send}
              actionsDisabled={props.actionsDisabled}
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
          <div class="action-buttons">
            <Button
              disabled={props.actionsDisabled}
              data-variant="solid"
              onClick={async () => await props.send({ type: "hit" })}
            >
              <SquarePlus size={16} />
              Hit
            </Button>
            <Show when={iCanStay()}>
              <Button
                disabled={props.actionsDisabled}
                onClick={async () => await props.send({ type: "stay" })}
              >
                <Coins size={16} />
                Stay with {myRound()} points
              </Button>
            </Show>
          </div>
        </Match>
        <Match when={props.room.turnId}>
          {(turnId) => (
            <p class="headline">
              {nameOf(props.room, turnId())} is deciding…
              <Show when={isOffline(props.room, turnId())}>
                <span class="muted">
                  {" "}
                  · Offline, so they'll{" "}
                  {canStayById(props.room, turnId()) ? "stay" : "hit"} soon.
                </span>
              </Show>
            </p>
          )}
        </Match>
      </Switch>
    </section>
  );
};

export default function Table(
  props: TableProps & DealProps & { chat: RoomConnection["chat"] }
) {
  return (
    <div class="table">
      <header class="table-header">
        <h1>Round {props.room.round}</h1>
        <div class="row">
          <InviteButton />
          <LeaveRoom
            disabled={props.actionsDisabled}
            onLeave={() => {
              void props.send({ type: "leave" });
            }}
          />
        </div>
      </header>

      <ActionBar
        room={props.room}
        playerId={props.playerId}
        send={props.send}
        actionsDisabled={props.actionsDisabled}
        dealing={props.dealing}
        dealStep={props.dealStep}
      />

      <div class="table-body">
        <div class="seats">
          <For each={props.room.players} keyed={(player) => player.id}>
            {(player) => (
              <RoundPlayer
                player={player()}
                room={props.room}
                playerId={props.playerId}
                send={props.send}
                actionsDisabled={props.actionsDisabled}
                incomingCardId={props.incomingCardId}
                dealStep={props.dealStep}
              />
            )}
          </For>
        </div>

        <div class="stack table-sidebar">
          <Leaderboard room={props.room} playerId={props.playerId} />
          <GameLog
            log={props.room.log}
            playerId={props.playerId}
            onChat={props.chat}
          />
        </div>
      </div>
      <div class="flight-layer" data-flight-layer="" aria-hidden="true" />
    </div>
  );
}
