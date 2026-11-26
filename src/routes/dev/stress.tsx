import { useSearchParams } from "@solidjs/router";
import type { RouteDefinition } from "@solidjs/router";
import { httpStatus } from "@solidjs/web";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";

import Lobby from "../../components/lobby";
import SiteNav from "../../components/site-nav";
import Table from "../../components/table";
import { createSheetTable } from "../../components/table-common";
import { DATASETS, PHASES, stressRoom, VIEWERS } from "../../dev/stress-rooms";
import { roundPointsFor } from "../../lib/deal-playback";
import { createRoomChatLog } from "../../lib/room-chat-log";
import type { RoomConnection } from "../../lib/room-connection";
import { resultsRound } from "../../lib/table-prompt";
import NotFound from "../[...404]";

const LABELS = {
  demo: "Demo data",
  full: "Full room",
  gameOver: "Game over",
  lobby: "Lobby",
  minimum: "Minimum",
  player: "Player",
  playing: "Playing",
  roundOver: "Round over",
  watcher: "Watcher",
  worst: "Worst case",
} as const;

const pick = <T extends string>(
  options: readonly T[],
  value: string | string[] | undefined,
  fallback: T
) => options.find((option) => option === value) ?? fallback;

const ignore = (...args: unknown[]) => {
  console.info("[stress] ignored", ...args);
};

const send: RoomConnection["send"] = async (message) => {
  ignore(message);
  await Promise.resolve();

  return true;
};

const chat = {
  send: (text: string) => {
    ignore(text);

    return true;
  },
  typing: ignore,
};

const Segments = <T extends keyof typeof LABELS>(props: {
  name: string;
  options: readonly T[];
  value: T;
  onPick: (value: T) => void;
}) => (
  <fieldset aria-label={props.name}>
    <For each={props.options}>
      {(option) => (
        <button
          type="button"
          data-slot="button"
          data-size="sm"
          data-variant={props.value === option ? "solid" : undefined}
          aria-pressed={props.value === option ? "true" : "false"}
          onClick={() => {
            props.onPick(option);
          }}
        >
          {LABELS[option]}
        </button>
      )}
    </For>
  </fieldset>
);

const StressPage = () => {
  const [params, setParams] = useSearchParams();
  const dataset = () => pick(DATASETS, params.data, "worst");
  const phase = () => pick(PHASES, params.phase, "playing");
  const viewer = () => pick(VIEWERS, params.as, "player");

  const [mounted, setMounted] = createSignal(false);
  const [open, setOpen] = createSignal(true);

  onSettled(() => {
    setMounted(true);
  });

  const view = createMemo(() =>
    mounted() ? stressRoom(dataset(), phase(), viewer()) : null
  );

  return (
    <>
      <SiteNav />
      <main class="room-page">
        <Show when={view()} keyed>
          {(current) => {
            const chatLog = createRoomChatLog({
              chat,
              inSheet: createSheetTable(),
              log: () => current.room.log,
              playerId: () => current.playerId,
              players: () => current.room.players,
              resultsRound: () =>
                resultsRound(current.room, { dealing: false }),
              typing: () => current.typing,
            });

            return (
              <Show
                when={current.room.phase === "lobby"}
                fallback={
                  <Table
                    room={current.room}
                    playerId={current.playerId}
                    send={send}
                    chatLog={chatLog}
                    playback={{
                      dealing: false,
                      moment: null,
                      roundPoints: roundPointsFor(current.room),
                      step: null,
                    }}
                  />
                }
              >
                <Lobby
                  room={current.room}
                  playerId={current.playerId}
                  send={send}
                  chatLog={chatLog}
                  onWatchInstead={ignore}
                  watchInsteadPending={false}
                />
              </Show>
            );
          }}
        </Show>
      </main>
      <div data-stress-toggle="">
        <button
          type="button"
          data-slot="button"
          data-size="sm"
          aria-expanded={open() ? "true" : "false"}
          onClick={() => {
            setOpen(!open());
          }}
        >
          {open() ? "Hide" : "Stress data"}
        </button>
        <Show when={open()}>
          <Segments
            name="Data"
            options={DATASETS}
            value={dataset()}
            onPick={(data) => {
              setParams({ data }, { replace: true });
            }}
          />
          <Segments
            name="Phase"
            options={PHASES}
            value={phase()}
            onPick={(next) => {
              setParams({ phase: next }, { replace: true });
            }}
          />
          <Segments
            name="Viewer"
            options={VIEWERS}
            value={viewer()}
            onPick={(as) => {
              setParams({ as }, { replace: true });
            }}
          />
        </Show>
      </div>
    </>
  );
};

export const route = {
  preload: () => {
    if (!import.meta.env.DEV) {
      httpStatus(404);
    }
  },
} satisfies RouteDefinition;

export default function Stress() {
  return import.meta.env.DEV ? <StressPage /> : <NotFound />;
}
