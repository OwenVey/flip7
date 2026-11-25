import CircleX from "@lucide/solid/icons/circle-x";
import LockKeyhole from "@lucide/solid/icons/lock-keyhole";
import { createEffect, createMemo, For, Show } from "solid-js";

import type { Player, RoundStatus } from "../game/engine";
import type { RoomView } from "../game/protocol";
import { createCountUp } from "../lib/count-up";
import { pointsOf } from "../lib/deal-playback";
import { rankPlayers } from "../lib/standings";
import { slideRows } from "../lib/table-motion";
import { ROUND_COUNT_MS, samePlayerIds, SCORES_TITLE } from "./table-common";
import type { RoundPointsByPlayer, TableProps } from "./table-common";

const CountUp = (props: { value: number }) => {
  const shown = createCountUp(() => props.value);

  return <>{shown()}</>;
};

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

const LeaderboardRound = (props: {
  player: Player;
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

  return (
    <td
      class="leaderboard-round"
      data-round-state={state()}
      data-scored={scored() ? "" : undefined}
      aria-label={`${props.points} ${props.points === 1 ? "point" : "points"}, ${roundPointsLabels[state()]}`}
      style={{ "--row-index": props.index }}
    >
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
    </td>
  );
};

const Leaderboard = (
  props: Pick<TableProps, "room" | "playerId"> & RoundPointsByPlayer
) => {
  const ranked = createMemo(() => rankPlayers(props.room.players));

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
          <th scope="col">Rank</th>
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
                    <td>{entry().rank}</td>
                    <th scope="row">
                      {entry().player.name}
                      <Show when={id === props.playerId}>
                        {" "}
                        <span class="badge">You</span>
                      </Show>
                    </th>
                    <LeaderboardRound
                      player={entry().player}
                      phase={props.room.phase}
                      points={pointsOf(props.roundPoints, id)}
                      index={entry().index}
                    />
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
