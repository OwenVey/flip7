import Crown from "@lucide/solid/icons/crown";
import PlayingCards from "@lucide/solid/icons/playing-cards";
import PlayingCardsFan from "@lucide/solid/icons/playing-cards-fan";
import Snowflake from "@lucide/solid/icons/snowflake";
import Trophy from "@lucide/solid/icons/trophy";
import { Meter, MeterIndicator, MeterTrack } from "@ui-sdk/solid/meter";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Repeat,
  Show,
} from "solid-js";

import { calculateRoundScore } from "../game/cards";
import type { Card } from "../game/cards";
import { FLIP_THREE_COUNT } from "../game/engine";
import type { ActionCardChoice, Player, RoundStatus } from "../game/engine";
import type { RoomView } from "../game/protocol";
import { createCountUp } from "../lib/count-up";
import type { DealStep } from "../lib/deal-plan";
import { motionAllowed } from "../lib/motion";
import { pop } from "../lib/table-motion";
import OfflineBadge from "./offline-badge";
import PlayerAvatar from "./player-avatar";
import PlayingCard from "./playing-card";
import RemovePlayer from "./remove-player";
import { nameOf, ROUND_COUNT_MS, stepPlayerId } from "./table-common";
import type { DealProps, MoveControls, TableProps } from "./table-common";
import Tooltip from "./tooltip";

const STATUS_LABELS = {
  active: "Active",
  busted: "Busted",
  frozen: "Frozen",
  out: "Sitting out",
  stayed: "Stayed",
  flipSeven: "Flip 7!",
} as const satisfies Record<RoundStatus, string>;

const STAMPED_STATUSES: ReadonlySet<RoundStatus> = new Set([
  "busted",
  "flipSeven",
  "frozen",
  "stayed",
]);

interface FlipProgress {
  flipped: number;
  total: number;
  waiting: boolean;
}

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

const sameCards = <T extends { id: number }>(a: T[], b: T[]) =>
  a.length === b.length && a.every((card, index) => card.id === b[index]?.id);

const FLIP_EXIT_MS = 220;

interface ShownFlip {
  progress: FlipProgress;
  leaving: boolean;
}

const createShownFlip = (flip: () => FlipProgress | null) => {
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

const choiceVerb = (kind: ActionCardChoice["card"]["kind"]) => {
  if (kind === "freeze") {
    return "Freeze";
  }

  if (kind === "flipThree") {
    return "Play Flip Three on";
  }

  return "Give Second Chance to";
};

const pickLabel = (
  room: RoomView,
  playerId: string | null,
  kind: ActionCardChoice["card"]["kind"],
  targetId: string,
  forId: string | undefined
) => {
  let target = nameOf(room, targetId);

  if (targetId === playerId) {
    target = "yourself";
  } else if (targetId === forId) {
    target = "themselves";
  }

  const label = `${choiceVerb(kind)} ${target}`;

  return forId === undefined ? label : `${label} for ${nameOf(room, forId)}`;
};

const RoundPlayer = (
  props: TableProps &
    MoveControls &
    Pick<DealProps, "dealStep"> & {
      player: Player;
      roundPoints: number;
    }
) => {
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

  const isDupe = (card: Card) => {
    const bust = bustCard();

    return (
      bust?.kind === "number" &&
      card.kind === "number" &&
      card.value === bust.value
    );
  };

  const flip = createMemo(
    () => flipProgress(props.room, props.dealStep, props.player.id),
    { equals: sameProgress }
  );

  const shownFlip = createShownFlip(flip);

  const playedCard = createMemo(
    () => {
      const step = props.dealStep;

      return step?.to.kind === "played" && step.to.playerId === props.player.id
        ? step.card
        : null;
    },
    { equals: (a, b) => a?.id === b?.id }
  );

  const isDealer = () => props.room.dealerId === props.player.id;
  const isMe = () => props.player.id === props.playerId;
  const isHost = () => props.room.hostId === props.player.id;

  const hasDecision = createMemo(
    () => props.moves.waitingOn?.playerId === props.player.id
  );

  const canKick = createMemo(() =>
    props.moves.host.kick.includes(props.player.id)
  );

  const isFrozen = () => props.player.status === "frozen";

  const isWinner = () =>
    props.room.phase === "gameOver" &&
    props.room.winnerIds.includes(props.player.id);

  const pickKind = createMemo(() =>
    props.moves.choice?.targets.includes(props.player.id) === true
      ? props.room.choice?.card.kind
      : undefined
  );

  const playing = createMemo(() => props.room.phase === "playing");
  const stampedPoints = createMemo(() => props.roundPoints);
  const roundPoints = createMemo(() => (playing() ? stampedPoints() : 0));

  const baseScore = () => props.player.score;

  const projectedScore = () => baseScore() + roundPoints();

  const shownBaseScore = createCountUp(baseScore);

  const shownRoundPoints = createCountUp(roundPoints, {
    durationMs: ROUND_COUNT_MS,
  });

  let bankedLabel: HTMLSpanElement | undefined;

  createEffect(baseScore, (score, previous) => {
    if (previous !== undefined && score > previous) {
      pop(bankedLabel, 1.35);
    }
  });

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

  const atTarget = () => projectedScore() >= props.room.settings.targetScore;

  const scorePercent = (score: number) =>
    `${Math.min(100, (score / props.room.settings.targetScore) * 100)}%`;

  const scoreDetails = () => {
    const details: string[] = [];

    if (roundPoints() > 0) {
      details.push(`${roundPoints()} this round`);
    }

    if (atTarget()) {
      details.push("at the target");
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
      data-status={props.player.status}
      data-seat={props.player.id}
      data-flipping={flip()?.waiting === false ? "" : undefined}
      data-turn={hasDecision() ? "" : undefined}
      data-me={isMe() ? "" : undefined}
      data-winner={isWinner() ? "" : undefined}
      data-offline={props.player.connected ? undefined : ""}
      data-pickable={pickKind()}
      data-unpickable={props.moves.choice && !pickKind() ? "" : undefined}
      aria-label={`${props.player.name}, ${props.player.score} points`}
    >
      <Show when={pickKind()}>
        {(kind) => (
          <button
            type="button"
            data-game-tap=""
            class="seat-pick"
            disabled={props.actionsDisabled}
            aria-label={pickLabel(
              props.room,
              props.playerId,
              kind(),
              props.player.id,
              props.moves.choice?.forId
            )}
            onClick={() => {
              props.onChoose(props.player.id);
            }}
          />
        )}
      </Show>
      <header class="seat-header">
        <div class="seat-name">
          <PlayerAvatar player={props.player} />
          <strong>{props.player.name}</strong>
          <Show when={isMe()}>
            <span class="badge">You</span>
          </Show>
          <Show when={props.player.bot}>
            <span class="badge" data-tone="bot">
              Bot
            </span>
          </Show>
          <Show when={isDealer()}>
            <Tooltip
              content="Dealer"
              type="label"
              trigger={(hint) => <span {...hint} class="dealer-chip" />}
            >
              <PlayingCards size={14} strokeWidth={2.25} aria-hidden="true" />
            </Tooltip>
          </Show>
          <Show when={isHost()}>
            <Tooltip
              content="Host"
              type="label"
              trigger={(hint) => <span {...hint} class="host-chip" />}
            >
              <Crown size={12} strokeWidth={2.25} aria-hidden="true" />
            </Tooltip>
          </Show>
          <Show when={isWinner()}>
            <span class="badge" data-tone="winner">
              <Trophy size={12} aria-hidden="true" />
              Winner
            </span>
          </Show>
          <Show when={!props.player.connected}>
            <OfflineBadge />
          </Show>
        </div>
        <div class="seat-meta">
          <Show when={shownFlip()}>
            {(shown) => (
              <FlipTracker
                progress={shown().progress}
                leaving={shown().leaving}
                card={playedCard()}
              />
            )}
          </Show>
          <Show when={hasDecision()}>
            <span class="badge" data-tone="turn">
              {decisionLabel()}
            </span>
          </Show>
          <Show when={props.player.status !== "active"}>
            <span
              class={[
                "status-pill",
                { "sr-only": STAMPED_STATUSES.has(props.player.status) },
              ]}
            >
              <Show when={isFrozen()}>
                <Snowflake size={12} aria-hidden="true" />
              </Show>
              {STATUS_LABELS[props.player.status]}
            </span>
          </Show>
          <Show when={props.player.status === "out"}>
            <span class="muted">
              {props.room.phase === "gameOver"
                ? "Plays next game"
                : "Plays next round"}
            </span>
          </Show>
        </div>
        <ul
          class="seat-extras"
          aria-label={`${props.player.name}'s modifier and Second Chance cards`}
        >
          <For each={extraCards()} keyed={(card) => card.id}>
            {(card) => <PlayingCard card={card()} size="mini" />}
          </For>
        </ul>
        <Show when={canKick()}>
          <RemovePlayer
            bot={props.player.bot}
            disabled={props.offline}
            name={props.player.name}
            onRemove={() => {
              void props.send({ playerId: props.player.id, type: "kick" });
            }}
          />
        </Show>
      </header>
      <div class="hand-area">
        <ul class="hand" aria-label={`${props.player.name}'s cards`}>
          <For each={numberCards()} keyed={(card) => card.id}>
            {(card) => <PlayingCard card={card()} dupe={isDupe(card())} />}
          </For>
          <Show when={bustCard()}>
            {(card) => <PlayingCard card={card()} bust />}
          </Show>
        </ul>
        <Show when={STAMPED_STATUSES.has(props.player.status)}>
          <span class="hand-stamp" aria-hidden="true">
            <span>{STATUS_LABELS[props.player.status]}</span>
            <Show when={props.player.status !== "busted"}>
              <span class="hand-stamp-points">+{stampedPoints()}</span>
            </Show>
          </span>
        </Show>
      </div>
      <Show when={isFrozen()}>
        <Snowflake class="frost-burst" aria-hidden="true" />
      </Show>
      <Meter
        aria-label="Total score"
        class="seat-meter"
        value={props.player.score}
        max={props.room.settings.targetScore}
        data-round={roundRisk()}
        data-winning={atTarget() ? "" : undefined}
        style={{
          "--lost-end": scorePercent(baseScore() + lostPoints()),
          "--projected-score": scorePercent(projectedScore()),
          "--round-start": scorePercent(baseScore()),
        }}
        getValueLabel={(value, details) =>
          [`${value} of ${details.max} points`, ...scoreDetails()].join(", ")
        }
      >
        <span
          class="seat-score"
          data-banked=""
          aria-hidden="true"
          ref={(element) => {
            bankedLabel = element;
          }}
        >
          {shownBaseScore()} / {props.room.settings.targetScore}
        </span>
        <MeterTrack>
          <MeterIndicator />
          <span
            class="meter-round"
            data-divider={baseScore() > 0 && roundPoints() > 0 ? "" : undefined}
          />
          <Show when={lostPoints() > 0}>
            <span class="meter-lost" />
          </Show>
        </MeterTrack>
        <Show when={playing()}>
          <span class="seat-score" data-projected="" aria-hidden="true">
            +{shownRoundPoints()}
          </span>
        </Show>
      </Meter>
    </article>
  );
};

export default RoundPlayer;
