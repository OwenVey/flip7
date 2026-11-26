import CircleX from "@lucide/solid/icons/circle-x";
import Flame from "@lucide/solid/icons/flame";
import LockKeyhole from "@lucide/solid/icons/lock-keyhole";
import { createEffect, createMemo, For, Show } from "solid-js";

import { cardLabel } from "../game/cards";
import type { Card, RoundScore } from "../game/cards";
import type { Player, RoundStatus } from "../game/engine";
import type { RoomView } from "../game/protocol";
import { createCountUp } from "../lib/count-up";
import { pointsOf } from "../lib/deal-playback";
import { roundScoreRows } from "../lib/round-score-breakdown";
import { finalStandings, rankPlayers } from "../lib/standings";
import type { FinalPlayer } from "../lib/standings";
import { slideRows } from "../lib/table-motion";
import { ROUND_COUNT_MS, samePlayerIds, SCORES_TITLE } from "./table-common";
import type { RoundPointsByPlayer, TableProps } from "./table-common";
import Tooltip from "./tooltip";

const CountUp = (props: { value: number }) => {
  const shown = createCountUp(() => props.value);

  return <>{shown()}</>;
};

const NotRanked = () => (
  <>
    <span aria-hidden="true">–</span>
    <span class="sr-only">Not ranked yet</span>
  </>
);

const roundPointsState = (status: RoundStatus, scored: boolean) => {
  if (status === "busted" || status === "out") {
    return status;
  }

  return scored || status !== "active" ? "banked" : "at-risk";
};

const roundPointsLabels = {
  "at-risk": "in play",
  banked: "banked",
  busted: "busted",
  out: "sitting out",
};

const ScoreChip = (props: { card: Card }) => (
  <span
    class="score-chip"
    style={{
      "--chip-color":
        props.card.kind === "number"
          ? `var(--number-${props.card.value})`
          : "var(--score-modifier)",
    }}
  >
    {cardLabel(props.card)}
  </span>
);

const RoundScoreBreakdown = (props: {
  score: RoundScore;
  hand: readonly Card[];
}) => {
  const rows = createMemo(() => roundScoreRows(props.score, props.hand));

  return (
    <dl class="round-breakdown">
      <For each={rows()}>
        {(row, index) => (
          <div>
            <dt>{row.label}</dt>{" "}
            <dd class="round-breakdown-cards" aria-hidden="true">
              <For each={row.cards}>{(card) => <ScoreChip card={card} />}</For>
              <Show when={row.flipSeven}>
                <Flame size={14} />
              </Show>
            </dd>
            <dd>
              {row.value}
              <Show when={index() < rows().length - 1}>
                <span class="sr-only">,</span>
              </Show>
            </dd>
          </div>
        )}
      </For>
    </dl>
  );
};

const LeaderboardRound = (props: {
  player: Pick<Player, "hand" | "lastRound" | "status">;
  phase: RoomView["phase"];
  points: number;
  index: number;
}) => {
  const scored = () =>
    props.phase === "roundOver" || props.phase === "gameOver";

  const state = createMemo(() =>
    roundPointsState(props.player.status, scored())
  );

  const shownPoints = createCountUp(() => props.points, {
    durationMs: ROUND_COUNT_MS,
  });

  const label = () =>
    `${props.points} ${props.points === 1 ? "point" : "points"}, ${roundPointsLabels[state()]}`;

  const breakdown = createMemo(() => {
    const score = props.player.lastRound;

    return scored() &&
      state() === "banked" &&
      score !== null &&
      shownPoints() === score.total
      ? score
      : null;
  });

  return (
    <td
      class="leaderboard-round"
      data-round-state={state()}
      data-scored={scored() ? "" : undefined}
      aria-label={breakdown() === null ? label() : undefined}
      style={{ "--row-index": props.index }}
    >
      <Show
        when={breakdown()}
        fallback={
          <span>
            <Show when={state() === "banked" && !scored()}>
              <LockKeyhole size={12} aria-hidden="true" />
            </Show>
            <Show when={state() === "busted"}>
              <CircleX size={12} aria-hidden="true" />
            </Show>
            {state() === "busted" || state() === "out"
              ? shownPoints()
              : `+${shownPoints()}`}
          </span>
        }
      >
        {(score) => (
          <Tooltip
            content={
              <RoundScoreBreakdown score={score()} hand={props.player.hand} />
            }
            type="description"
            toggleable
            trigger={(hint) => (
              <button
                {...hint}
                type="button"
                class="round-breakdown-trigger"
                aria-label={label()}
              />
            )}
          >
            +{score().total}
          </Tooltip>
        )}
      </Show>
    </td>
  );
};

const isLeft = (player: Player | FinalPlayer) =>
  "left" in player && player.left;

const Leaderboard = (
  props: Pick<TableProps, "room" | "playerId"> & RoundPointsByPlayer
) => {
  const ranked = createMemo(() =>
    props.room.phase === "gameOver"
      ? finalStandings(props.room)
      : rankPlayers(props.room.players)
  );

  const unranked = createMemo(
    () =>
      props.room.phase !== "gameOver" &&
      props.room.players.every((player) => player.score === 0)
  );

  const rankedIds = createMemo(() => ranked().map(({ player }) => player.id), {
    equals: samePlayerIds,
  });

  let body: HTMLTableSectionElement | undefined;
  let rowTops = new Map<string, number>();

  createEffect(rankedIds, () => {
    rowTops = slideRows(body, rowTops);
  });

  return (
    <table class="leaderboard" aria-label={SCORES_TITLE}>
      <thead>
        <tr>
          <th scope="col" aria-label="Rank">
            #
          </th>
          <th scope="col">Player</th>
          <th scope="col">Round</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody
        ref={(element) => {
          body = element;
        }}
      >
        <For each={rankedIds()}>
          {(id, index) => (
            <Show when={ranked()[index()]}>
              {(entry) => {
                const won = () => props.room.winnerIds.includes(id);
                const left = () => isLeft(entry().player);

                const medal = () =>
                  props.room.phase === "gameOver" &&
                  !won() &&
                  (entry().rank === 2 || entry().rank === 3)
                    ? entry().rank
                    : undefined;

                return (
                  <tr
                    data-key={id}
                    data-me={id === props.playerId ? "" : undefined}
                    data-medal={medal()}
                    data-winner={won() ? "" : undefined}
                  >
                    <td>
                      <Show when={!unranked()} fallback={<NotRanked />}>
                        {entry().rank}
                      </Show>
                    </td>
                    <th
                      scope="row"
                      aria-label={`${entry().player.name}${left() ? " (Left)" : ""}${id === props.playerId ? " (You)" : ""}`}
                    >
                      <span class="leaderboard-player">
                        <span
                          class="leaderboard-name"
                          dir="auto"
                          title={entry().player.name}
                        >
                          {entry().player.name}
                        </span>
                        <Show when={left()}>
                          {" "}
                          <span class="badge">Left</span>
                        </Show>
                      </span>
                      <Show when={id === props.playerId}>
                        <span class="sr-only"> (You)</span>
                      </Show>
                    </th>
                    <Show
                      when={!left()}
                      fallback={
                        <td class="leaderboard-round" aria-label="Left">
                          —
                        </td>
                      }
                    >
                      <LeaderboardRound
                        player={entry().player}
                        phase={props.room.phase}
                        points={pointsOf(props.roundPoints, id)}
                        index={entry().index}
                      />
                    </Show>
                    <td
                      class="leaderboard-total"
                      aria-label={`${entry().player.score}`}
                    >
                      <CountUp value={entry().player.score} />
                    </td>
                  </tr>
                );
              }}
            </Show>
          )}
        </For>
      </tbody>
    </table>
  );
};

export default Leaderboard;
