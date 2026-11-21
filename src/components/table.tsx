import ArrowLeft from "@lucide/solid/icons/arrow-left";
import ArrowRight from "@lucide/solid/icons/arrow-right";
import BotIcon from "@lucide/solid/icons/bot";
import Flame from "@lucide/solid/icons/flame";
import Hand from "@lucide/solid/icons/hand";
import MessageCircle from "@lucide/solid/icons/message-circle";
import PlayingCards from "@lucide/solid/icons/playing-cards";
import PlayingCardsFan from "@lucide/solid/icons/playing-cards-fan";
import Snowflake from "@lucide/solid/icons/snowflake";
import SquarePlus from "@lucide/solid/icons/square-plus";
import Trophy from "@lucide/solid/icons/trophy";
import WifiOff from "@lucide/solid/icons/wifi-off";
import { Button } from "@ui-sdk/solid/button";
import { Meter, MeterIndicator, MeterTrack } from "@ui-sdk/solid/meter";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Repeat,
  Show,
  Switch,
  untrack,
} from "solid-js";

import { cardLabel, calculateRoundScore } from "../game/cards";
import type { Card } from "../game/cards";
import { FLIP_SEVEN_STATUS, FLIP_THREE_COUNT } from "../game/engine";
import type {
  ActionCardChoice,
  HeldCard,
  LogEntry,
  RoundStatus,
} from "../game/engine";
import { availableMoves } from "../game/moves";
import type { AvailableMoves } from "../game/moves";
import type { PlayerView, RoomView } from "../game/protocol";
import { createCountUp } from "../lib/count-up";
import type { DealStep } from "../lib/deal-plan";
import type { RoomConnection } from "../lib/room-connection";
import { passDealerChip, pop, slideRows } from "../lib/table-motion";
import type { ChipSpot } from "../lib/table-motion";
import CardTooltips from "./card-tooltips";
import GameLog, { CHAT_AND_GAME_LOG_TITLE } from "./game-log";
import InviteButton from "./invite-button";
import LeaveRoom from "./leave-room";
import PlayingCard from "./playing-card";
import RemovePlayer from "./remove-player";
import TableSheet from "./table-sheet";
import Tooltip from "./tooltip";

const STATUS_LABELS = {
  active: "Active",
  busted: "Busted",
  frozen: "Frozen",
  out: "Sitting out",
  stayed: "Stayed",
  [FLIP_SEVEN_STATUS]: "Flip 7!",
} as const satisfies Record<RoundStatus, string>;

const SCORES_TITLE = "Scores";

const STAMPED_STATUSES: ReadonlySet<RoundStatus> = new Set([
  "busted",
  "frozen",
  "stayed",
]);

interface TableProps {
  room: RoomView;
  playerId: string;
  send: RoomConnection["send"];
  actionsDisabled?: boolean;
}

interface MoveControls {
  moves: AvailableMoves;
  onChoose: (targetId: string) => void;
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

const choiceVerb = (choice: ActionCardChoice) => {
  if (choice.card.kind === "freeze") {
    return "Freeze";
  }

  if (choice.card.kind === "flipThree") {
    return "Play Flip Three on";
  }

  return "Give Second Chance to";
};

const pickLabel = (
  room: RoomView,
  playerId: string,
  choice: ActionCardChoice,
  targetId: string,
  forId: string | undefined
) => {
  let target = nameOf(room, targetId);

  if (targetId === playerId) {
    target = "yourself";
  } else if (targetId === forId) {
    target = "themselves";
  }

  const label = `${choiceVerb(choice)} ${target}`;

  return forId === undefined ? label : `${label} for ${nameOf(room, forId)}`;
};

const FitLabel = (props: { long: string; short: string }) => (
  <>
    <span class="label-long">{props.long}</span>
    <span class="label-short" aria-hidden="true">
      {props.short}
    </span>
  </>
);

const RoundPlayer = (
  props: TableProps &
    MoveControls &
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

  const isDealer = () => props.room.dealerId === props.player.id;
  const isMe = () => props.player.id === props.playerId;
  const canKick = () => props.moves.host.kick.includes(props.player.id);

  const hasDecision = () => props.moves.waitingOn?.playerId === props.player.id;

  const isFrozen = () => props.player.status === "frozen";

  const pickChoice = () =>
    props.moves.choice?.targets.includes(props.player.id) === true
      ? props.room.choice
      : null;

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

  const atTarget = () => projectedScore() >= props.room.targetScore;

  const scorePercent = (score: number) =>
    `${Math.min(100, (score / props.room.targetScore) * 100)}%`;

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
      data-pickable={pickChoice()?.card.kind}
      aria-label={`${props.player.name}, ${props.player.score} points`}
    >
      <Show when={pickChoice()}>
        {(choice) => (
          <button
            type="button"
            class="seat-pick"
            disabled={props.actionsDisabled}
            aria-label={pickLabel(
              props.room,
              props.playerId,
              choice(),
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
          <Show when={props.player.bot}>
            <Tooltip
              content="Bot"
              type="label"
              trigger={(hint) => <span {...hint} class="bot-avatar" />}
            >
              <BotIcon size={16} strokeWidth={2.25} aria-hidden="true" />
            </Tooltip>
          </Show>
          <strong>{props.player.name}</strong>
          <Show when={isDealer()}>
            <Tooltip
              content="Dealer"
              type="label"
              trigger={(hint) => <span {...hint} class="dealer-chip" />}
            >
              <PlayingCards size={14} strokeWidth={2.25} aria-hidden="true" />
            </Tooltip>
          </Show>
          <Show when={isMe()}>
            <span class="badge">You</span>
          </Show>
          <Show when={!props.player.connected}>
            <span class="badge" data-tone="danger">
              <WifiOff size={12} aria-hidden="true" />
              Offline
            </span>
          </Show>
        </div>
        <div class="seat-meta">
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
          <Show when={flip()}>
            {(progress) => <FlipTracker progress={progress()} />}
          </Show>
        </div>
        <ul
          class="seat-extras"
          aria-label={`${props.player.name}'s modifier and Second Chance cards`}
        >
          <For each={extraCards()} keyed={(card) => card.id}>
            {(card) => <PlayingCard card={card()} />}
          </For>
        </ul>
        <Show when={canKick()}>
          <RemovePlayer
            bot={props.player.bot}
            disabled={props.actionsDisabled}
            name={props.player.name}
            onRemove={() => {
              void props.send({ playerId: props.player.id, type: "kick" });
            }}
          />
        </Show>
      </header>
      <ul
        class="hand"
        aria-label={`${props.player.name}'s cards`}
        data-banked={
          props.player.status === "stayed" || props.player.status === "frozen"
            ? roundPoints()
            : undefined
        }
      >
        <For each={numberCards()} keyed={(card) => card.id}>
          {(card) => <PlayingCard card={card()} dupe={isDupe(card())} />}
        </For>
        <Show when={bustCard()}>
          {(card) => <PlayingCard card={card()} bust />}
        </Show>
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
          {shownBaseScore()}
        </span>
        <MeterTrack>
          <MeterIndicator />
          <span class="meter-round" />
          <Show when={lostPoints() > 0}>
            <span class="meter-lost" />
          </Show>
        </MeterTrack>
        <span class="seat-score" data-projected="" aria-hidden="true">
          +{roundPoints()}
        </span>
      </Meter>
    </article>
  );
};

const countChatsAfter = (log: LogEntry[], playerId: string, seenId: number) =>
  log.filter(
    (entry) =>
      entry.id > seenId &&
      entry.from !== undefined &&
      entry.from.id !== playerId
  ).length;

const ActionCardPrompt = (
  props: Pick<TableProps, "room"> &
    Pick<MoveControls, "moves"> & { choice: ActionCardChoice }
) => (
  <>
    <ul class="dealt-action-card" data-choice-card="" aria-hidden="true">
      <PlayingCard card={props.choice.card} />
    </ul>
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
              · The game will play {cardLabel(props.choice.card)} for them soon.
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
            {choiceVerb(props.choice)}…{" "}
            <span class="muted">· Pick a player</span>
          </p>
        </Show>
      )}
    </Show>
  </>
);

const CountUp = (props: { value: number }) => {
  const shown = createCountUp(() => props.value);

  return <>{shown()}</>;
};

const Leaderboard = (props: Pick<TableProps, "room" | "playerId">) => {
  const ranked = createMemo(() => {
    const players = props.room.players.toSorted((a, b) => b.score - a.score);
    let rank = 1;

    return players.map((player, index) => {
      if (index > 0 && player.score !== players[index - 1]?.score) {
        rank = index + 1;
      }

      return { index, player, rank };
    });
  });

  const roundScored = () =>
    props.room.phase === "roundOver" || props.room.phase === "gameOver";

  let body: HTMLTableSectionElement | undefined;
  let rowTops = new Map<string, number>();

  createEffect(
    () =>
      ranked()
        .map((entry) => entry.player.id)
        .join(","),
    () => {
      rowTops = slideRows(body, rowTops);
    }
  );

  return (
    <table class="leaderboard" aria-label={SCORES_TITLE}>
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
      <tbody
        ref={(element) => {
          body = element;
        }}
      >
        <For each={ranked()} keyed={(entry) => entry.player.id}>
          {(entry) => (
            <tr
              data-key={entry().player.id}
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
                <td
                  class="muted leaderboard-round"
                  style={{ "--row": entry().index }}
                >
                  +{entry().player.lastRound?.total ?? 0}
                </td>
              </Show>
              <td class="leaderboard-total">
                <CountUp value={entry().player.score} />
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
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

const LOW_DECK = 15;
const CONFETTI_PIECES = 56;

const CONFETTI_COLORS = [
  "var(--gold)",
  "var(--accent)",
  "var(--flip)",
  "var(--good)",
  "var(--danger)",
  "var(--freeze-ink)",
] as const;

const GOLDEN_RATIO = 0.618034;

const scatter = (index: number, salt: number) =>
  ((index + 1) * (GOLDEN_RATIO + salt)) % 1;

const deckStack = (count: number) => {
  if (count === 0) {
    return "empty";
  }

  return count <= LOW_DECK ? "low" : "full";
};

const automaticTurnLabel = (canStay: boolean) =>
  `The game will ${canStay ? "Stay" : "Hit"} for them soon.`;

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
        <Flame />
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

const Confetti = () => (
  <div class="confetti" aria-hidden="true">
    <Repeat count={CONFETTI_PIECES}>
      {(index) => (
        <span
          class="confetti-piece"
          style={{
            "--color": CONFETTI_COLORS[index % CONFETTI_COLORS.length],
            "--delay": `${Math.round(scatter(index, 0.11) * 600)}ms`,
            "--drift": `${Math.round((scatter(index, 0.23) - 0.5) * 16)}rem`,
            "--fall": `${Math.round(2200 + scatter(index, 0.37) * 1400)}ms`,
            "--spin": `${Math.round((scatter(index, 0.41) - 0.5) * 1440)}deg`,
            "--x": `${Math.round(scatter(index, 0) * 100)}%`,
          }}
        />
      )}
    </Repeat>
  </div>
);

const OfflineTurn = (
  props: Pick<TableProps, "room" | "send" | "actionsDisabled"> & {
    playerId: string;
    canStay: boolean;
  }
) => {
  const player = () =>
    props.room.players.find((candidate) => candidate.id === props.playerId);

  const name = () => player()?.name ?? "Someone";

  const bankedPoints = () => {
    const current = player();
    const points = current ? currentRoundPoints(current) : 0;

    return points === 1 ? "1 point" : `${points} points`;
  };

  return (
    <>
      <p class="headline">
        {name()} is offline.{" "}
        <span class="muted">
          · Move for them now. {automaticTurnLabel(props.canStay)}
        </span>
      </p>
      <div class="action-buttons">
        <Button
          data-size="lg"
          disabled={props.actionsDisabled}
          data-variant="solid"
          aria-label={`Hit for ${name()}`}
          onClick={async () =>
            await props.send({ forId: props.playerId, type: "hit" })
          }
        >
          <SquarePlus size={16} />
          Hit for {name()}
        </Button>
        <Show when={props.canStay}>
          <Button
            data-size="lg"
            disabled={props.actionsDisabled}
            aria-label={`Stay for ${name()} with ${bankedPoints()}`}
            onClick={async () =>
              await props.send({ forId: props.playerId, type: "stay" })
            }
          >
            <Hand size={16} />
            <FitLabel
              long={`Stay for ${name()} · ${bankedPoints()}`}
              short={`Stay for ${name()}`}
            />
          </Button>
        </Show>
      </div>
    </>
  );
};

const ActionBar = (
  props: TableProps & DealProps & Pick<MoveControls, "moves">
) => {
  const me = () =>
    props.room.players.find((player) => player.id === props.playerId);

  const myTurn = () => {
    const { turn } = props.moves;

    return turn !== null && turn.forId === undefined && props.dealing !== true;
  };

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

  const iCanStay = () => props.moves.turn?.canStay === true;

  const myRound = () => {
    const player = me();

    return player ? currentRoundPoints(player) : 0;
  };

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
      aria-label="Your move"
      data-turn={myTurn() ? "" : undefined}
    >
      <Deck count={props.room.deckCount} />
      <Switch>
        <Match when={props.room.phase === "gameOver"}>
          <p class="headline">{winners()} wins!</p>
          <Show
            when={props.moves.host.lobby}
            fallback={<p class="muted">Waiting for the host.</p>}
          >
            <div class="action-buttons">
              <Button
                data-size="lg"
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
            when={props.moves.host.nextRound}
            fallback={
              <p class="muted">Waiting for the host to start the next round.</p>
            }
          >
            <div class="action-buttons">
              <Button
                data-size="lg"
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
          <div class="action-buttons">
            <Button
              data-size="lg"
              disabled={props.actionsDisabled}
              data-variant="solid"
              onClick={async () => await props.send({ type: "hit" })}
            >
              <SquarePlus size={16} />
              Hit
            </Button>
            <Show when={iCanStay()}>
              <Button
                data-size="lg"
                disabled={props.actionsDisabled}
                onClick={async () => await props.send({ type: "stay" })}
              >
                <Hand size={16} />
                Stay
              </Button>
            </Show>
          </div>
        </Match>
        <Match when={offlineTurn()}>
          {(turn) => (
            <OfflineTurn
              playerId={turn().playerId}
              canStay={turn().canStay}
              room={props.room}
              send={props.send}
              actionsDisabled={props.actionsDisabled}
            />
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
                  {automaticTurnLabel(props.moves.waitingOn?.canStay === true)}
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
  const moves = createMemo(() => availableMoves(props.room, props.playerId));

  const chooseTarget = (targetId: string) => {
    const { choice } = moves();

    if (
      props.actionsDisabled === true ||
      choice === null ||
      !choice.targets.includes(targetId)
    ) {
      return;
    }

    const { forId } = choice;
    void props.send({
      ...(forId !== undefined && { forId }),
      targetId,
      type: "choose",
    });
  };

  let chipSpot: ChipSpot | null = null;

  createEffect(
    () => props.room.dealerId,
    (dealerId) => {
      chipSpot = passDealerChip(dealerId, chipSpot);
    }
  );

  const [logOpen, setLogOpen] = createSignal(false);
  const latestLogId = () => props.room.log.at(-1)?.id ?? 0;
  const [seenLogId, setSeenLogId] = createSignal(untrack(latestLogId));

  const unreadChats = () =>
    logOpen()
      ? 0
      : countChatsAfter(props.room.log, props.playerId, seenLogId());

  const toggleLabel = () => {
    const unread = unreadChats();

    return unread > 0
      ? `${CHAT_AND_GAME_LOG_TITLE}, ${unread} new ${unread === 1 ? "message" : "messages"}`
      : CHAT_AND_GAME_LOG_TITLE;
  };

  const onLogOpenChange = (open: boolean) => {
    setSeenLogId(latestLogId());
    setLogOpen(open);
  };

  return (
    <CardTooltips>
      <div class="table" data-phase={props.room.phase}>
        <header class="table-header">
          <h1>Round {props.room.round}</h1>
          <div class="row">
            <Show when={props.room.phase === "playing"}>
              <TableSheet
                title={SCORES_TITLE}
                triggerLabel={SCORES_TITLE}
                trigger={<Trophy size={16} aria-hidden="true" />}
              >
                <Leaderboard room={props.room} playerId={props.playerId} />
              </TableSheet>
            </Show>
            <TableSheet
              title={CHAT_AND_GAME_LOG_TITLE}
              triggerLabel={toggleLabel()}
              keepMounted
              open={logOpen()}
              onOpenChange={onLogOpenChange}
              trigger={
                <>
                  <MessageCircle size={16} aria-hidden="true" />
                  <Show when={unreadChats() > 0}>
                    <span class="unread-count" aria-hidden="true">
                      {unreadChats()}
                    </span>
                  </Show>
                </>
              }
            >
              <GameLog
                inSheet
                log={props.room.log}
                playerId={props.playerId}
                onChat={props.chat}
              />
            </TableSheet>
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
          moves={moves()}
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
                  moves={moves()}
                  onChoose={chooseTarget}
                />
              )}
            </For>
          </div>

          <div class="stack table-sidebar">
            <section
              class="panel leaderboard-panel"
              aria-labelledby="leaderboard-title"
            >
              <h2 id="leaderboard-title">{SCORES_TITLE}</h2>
              <Leaderboard room={props.room} playerId={props.playerId} />
            </section>
            <GameLog
              log={props.room.log}
              playerId={props.playerId}
              onChat={props.chat}
            />
          </div>
        </div>
        <div class="flight-layer" data-flight-layer="" aria-hidden="true" />
        <div class="flight-layer" data-chip-layer="" aria-hidden="true" />
        <Show when={props.room.phase === "gameOver"}>
          <Confetti />
        </Show>
      </div>
    </CardTooltips>
  );
}
