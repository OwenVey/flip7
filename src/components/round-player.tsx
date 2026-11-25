import PlayingCards from "@lucide/solid/icons/playing-cards";
import Snowflake from "@lucide/solid/icons/snowflake";
import Trophy from "@lucide/solid/icons/trophy";
import { Meter, MeterIndicator, MeterTrack } from "@ui-sdk/solid/meter";
import { createEffect, createMemo, For, Show } from "solid-js";

import type { Card } from "../game/cards";
import type { ActionCardChoice, Player, RoundStatus } from "../game/engine";
import type { AvailableMoves } from "../game/moves";
import type { RoomView } from "../game/protocol";
import { createCountUp } from "../lib/count-up";
import type { DealStep } from "../lib/deal-plan";
import type { PlaybackMoment } from "../lib/playback-moments";
import { nameOf } from "../lib/player-name";
import { scoreMeter } from "../lib/score-meter";
import { pop } from "../lib/table-motion";
import FlipTracker, {
  createShownFlip,
  flipProgress,
  sameProgress,
} from "./flip-tracker";
import OfflineBadge from "./offline-badge";
import PlayerAvatar from "./player-avatar";
import PlayingCard from "./playing-card";
import RemovePlayer from "./remove-player";
import { ROUND_COUNT_MS } from "./table-common";
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

const sameCards = <T extends { id: number }>(a: T[], b: T[]) =>
  a.length === b.length && a.every((card, index) => card.id === b[index]?.id);

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

interface RoundPlayerProps {
  room: RoomView;
  player: Player;
  playerId: string | null;
  moves: AvailableMoves;
  dealing: boolean;
  dealMoment: PlaybackMoment | null;
  dealStep?: DealStep | null;
  roundPoints: number;
  actionsDisabled?: boolean;
  removeDisabled?: boolean;
  onPick: (targetId: string) => void;
  onRemove: (playerId: string) => void;
}

const RoundPlayer = (props: RoundPlayerProps) => {
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
    () =>
      props.dealMoment === null &&
      props.moves.waitingOn?.playerId === props.player.id
  );

  const canKick = createMemo(() =>
    props.moves.host.kick.includes(props.player.id)
  );

  const isFrozen = () => props.player.status === "frozen";

  const isWinner = () =>
    props.room.phase === "gameOver" &&
    !props.dealing &&
    props.room.winnerIds.includes(props.player.id);

  const pickKind = createMemo(() =>
    !props.dealing &&
    props.moves.choice?.targets.includes(props.player.id) === true
      ? props.room.choice?.card.kind
      : undefined
  );

  const playing = createMemo(() => props.room.phase === "playing");

  const meter = createMemo(() =>
    scoreMeter(
      props.player,
      props.room.phase,
      props.roundPoints,
      props.room.settings.targetScore
    )
  );

  const banked = createMemo(() => meter().banked);
  const round = createMemo(() => meter().round);
  const shownBaseScore = createCountUp(banked);

  const shownRoundPoints = createCountUp(round, {
    durationMs: ROUND_COUNT_MS,
  });

  let bankedLabel: HTMLSpanElement | undefined;

  createEffect(banked, (score, previous) => {
    if (previous !== undefined && score > previous) {
      pop(bankedLabel, 1.35);
    }
  });

  const scorePercent = (score: number) =>
    `${Math.min(100, (score / props.room.settings.targetScore) * 100)}%`;

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
      data-unpickable={
        !props.dealing && props.moves.choice && !pickKind() ? "" : undefined
      }
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
              props.onPick(props.player.id);
            }}
          />
        )}
      </Show>
      <header class="seat-header">
        <div class="seat-name">
          <span class="seat-avatar">
            <PlayerAvatar player={props.player} />
            <Show when={isMe()}>
              <span class="avatar-tag">You</span>
            </Show>
            <Show when={props.player.bot}>
              <span class="avatar-tag" data-tone="bot">
                Bot
              </span>
            </Show>
            <Show when={isHost()}>
              <Tooltip
                content="Host"
                type="label"
                trigger={(hint) => <span {...hint} class="host-chip" />}
              >
                <svg
                  viewBox="0 0 24 18"
                  width="30"
                  height="22"
                  aria-hidden="true"
                >
                  <path d="M2.5 5.5 7.5 10 12 2.5l4.5 7.5 5-4.5-2 10h-15z" />
                </svg>
              </Tooltip>
            </Show>
          </span>
          <strong title={props.player.name}>{props.player.name}</strong>
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
          <Show when={hasDecision() && !isMe()}>
            <span class="badge" data-tone="turn">
              {props.room.choice ? "Choosing…" : "Thinking…"}
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
            disabled={props.removeDisabled}
            name={props.player.name}
            onRemove={() => {
              props.onRemove(props.player.id);
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
        <Show when={isDealer()}>
          <Tooltip
            content="Dealer"
            type="label"
            trigger={(hint) => <span {...hint} class="dealer-chip" />}
          >
            <PlayingCards size={14} strokeWidth={2.25} aria-hidden="true" />
          </Tooltip>
        </Show>
        <Show when={STAMPED_STATUSES.has(props.player.status)}>
          <span class="hand-stamp" aria-hidden="true">
            <span>{STATUS_LABELS[props.player.status]}</span>
            <Show when={props.player.status !== "busted"}>
              <span class="hand-stamp-points">+{props.roundPoints}</span>
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
        data-round={meter().risk}
        data-winning={meter().atTarget ? "" : undefined}
        style={{
          "--lost-end": scorePercent(meter().banked + meter().lost),
          "--projected-score": scorePercent(meter().projected),
          "--round-start": scorePercent(banked()),
        }}
        getValueLabel={(value, details) =>
          [`${value} of ${details.max} points`, ...meter().details].join(", ")
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
            data-divider={banked() > 0 && round() > 0 ? "" : undefined}
          />
          <Show when={meter().lost > 0}>
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
