import ArrowLeft from "@lucide/solid/icons/arrow-left";
import ArrowRight from "@lucide/solid/icons/arrow-right";
import Coins from "@lucide/solid/icons/coins";
import Flame from "@lucide/solid/icons/flame";
import SquarePlus from "@lucide/solid/icons/square-plus";
import { Button } from "@ui-sdk/solid/button";
import { Meter, MeterIndicator, MeterTrack } from "@ui-sdk/solid/meter";
import { createMemo, For, Match, Show, Switch } from "solid-js";

import { cardLabel, calculateRoundScore } from "../game/cards";
import { blockingPlayerId, canStay, FLIP_SEVEN_STATUS } from "../game/engine";
import type { ActionCardChoice, RoundStatus } from "../game/engine";
import type { PlayerView, RoomView } from "../game/protocol";
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

const RoundPlayer = (props: TableProps & { player: PlayerView }) => {
  const isMe = () => props.player.id === props.playerId;
  const isHost = () => props.room.hostId === props.playerId;
  const hasDecision = () => blockingPlayerId(props.room) === props.player.id;

  const roundResult = () =>
    props.room.phase === "playing" ? null : props.player.lastRound;

  const pendingPoints = createMemo(() =>
    props.room.phase === "playing" && props.player.status !== "out"
      ? currentRoundPoints(props.player)
      : 0
  );

  const projectedScore = () => props.player.score + pendingPoints();

  const projectedPercent = () =>
    Math.min(100, (projectedScore() / props.room.targetScore) * 100);

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
      data-turn={hasDecision() ? "" : undefined}
      data-me={isMe() ? "" : undefined}
      aria-label={`${props.player.name}, ${props.player.score} points`}
    >
      <header class="seat-header">
        <div class="seat-name">
          <strong>{props.player.name}</strong>
          <Show when={isMe()}>
            <span class="badge">You</span>
          </Show>
          <Show when={props.room.dealerId === props.player.id}>
            <span class="badge" data-tone="muted">
              Dealer
            </span>
          </Show>
          <Show when={props.player.status === "active"}>
            <span class="active-indicator" title={STATUS_LABELS.active}>
              <span class="sr-only">{STATUS_LABELS.active}</span>
            </span>
          </Show>
          <Show when={hasDecision()}>
            <span class="badge" data-tone="turn">
              {decisionLabel()}
            </span>
          </Show>
          <Show when={!props.player.connected}>
            <span class="badge" data-tone="muted">
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
        <Show when={props.player.status !== "active"}>
          <span class="status-pill">{STATUS_LABELS[props.player.status]}</span>
        </Show>
        <span class="muted">
          <Show
            when={props.player.status !== "out"}
            fallback="Joins next round"
          >
            <strong class="round-points">
              {roundResult()?.total ?? pendingPoints()}
            </strong>{" "}
            {roundResult() ? "points scored this round" : "points this round"}
          </Show>
        </span>
      </div>
      <ul class="hand" aria-label={`${props.player.name}'s cards`}>
        <For each={props.player.hand} keyed={(card) => card.id}>
          {(card) => <PlayingCard card={card()} />}
        </For>
        <Show when={props.player.bustCard}>
          {(card) => <PlayingCard card={card()} bust />}
        </Show>
      </ul>
      <Meter
        aria-label="Total score"
        class="seat-meter"
        value={props.player.score}
        max={props.room.targetScore}
        style={{ "--projected-score": `${projectedPercent()}%` }}
        getValueLabel={(value, details) =>
          pendingPoints() > 0
            ? `${value} of ${details.max} points, ${projectedScore()} projected`
            : `${value} of ${details.max} points`
        }
      >
        <div class="seat-scores" aria-hidden="true">
          <span class="seat-score" data-banked="">
            {props.player.score}
          </span>
          <Show when={pendingPoints() > 0}>
            <span class="seat-score" data-projected="">
              {projectedScore()}
            </span>
          </Show>
          <span class="seat-score" data-goal="">
            {props.room.targetScore}
          </span>
        </div>
        <MeterTrack>
          <MeterIndicator />
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
    <Show
      when={props.choice.chooserId === props.playerId}
      fallback={
        <p class="headline">
          {nameOf(props.room, props.choice.chooserId)} is choosing who receives{" "}
          {cardLabel(props.choice.card)}.
          <Show when={isOffline(props.room, props.choice.chooserId)}>
            <span class="muted">
              {" "}
              · Offline, so it will be played for them soon.
            </span>
          </Show>
        </p>
      }
    >
      <ul class="dealt-action-card" aria-hidden="true">
        <PlayingCard card={props.choice.card} />
      </ul>
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

const ActionBar = (props: TableProps) => {
  const isHost = () => props.room.hostId === props.playerId;

  const me = () =>
    props.room.players.find((player) => player.id === props.playerId);

  const myTurn = () =>
    props.room.turnId === props.playerId && props.room.choice === null;

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
  props: TableProps & { chat: RoomConnection["chat"] }
) {
  return (
    <div class="table">
      <header class="table-header">
        <h1>Round {props.room.round}</h1>
        <dl class="table-stats">
          <div class="deck-stat">
            <dt>Deck</dt>
            <dd>
              {props.room.deckCount}
              <span
                class="card-back"
                data-empty={props.room.deckCount === 0 ? "" : undefined}
                aria-hidden="true"
              >
                <Flame />
              </span>
            </dd>
          </div>
          <div>
            <dt>Goal</dt>
            <dd>{props.room.targetScore}</dd>
          </div>
        </dl>
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
    </div>
  );
}
