import { useSearchParams } from "@solidjs/router";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";

import Lobby from "../../components/lobby";
import SiteNav from "../../components/site-nav";
import Table from "../../components/table";
import { DATASETS, PHASES, stressRoom, VIEWERS } from "../../dev/stress-rooms";
import { roundPointsFor } from "../../lib/deal-playback";
import type { RoomConnection } from "../../lib/room-connection";
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
  <fieldset
    aria-label={props.name}
    style={{
      background: "#e5e5e5",
      border: "none",
      "border-radius": "999px",
      display: "flex",
      margin: "0",
      gap: "2px",
      padding: "2px",
    }}
  >
    <For each={props.options}>
      {(option) => (
        <button
          type="button"
          aria-pressed={props.value === option ? "true" : "false"}
          onClick={() => {
            props.onPick(option);
          }}
          style={{
            all: "unset",
            background: props.value === option ? "#fff" : "transparent",
            "border-radius": "999px",
            "box-shadow":
              props.value === option ? "0 1px 2px rgb(0 0 0 / 0.2)" : "none",
            color: "#111",
            cursor: "pointer",
            padding: "4px 10px",
            "white-space": "nowrap",
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
          {(current) => (
            <Show
              when={current.room.phase === "lobby"}
              fallback={
                <Table
                  room={current.room}
                  playerId={current.playerId}
                  send={send}
                  chat={chat}
                  typing={current.typing}
                  roundPoints={roundPointsFor(current.room)}
                />
              }
            >
              <Lobby
                room={current.room}
                playerId={current.playerId}
                send={send}
                chat={chat}
                typing={current.typing}
                onWatchInstead={ignore}
                watchInsteadPending={false}
              />
            </Show>
          )}
        </Show>
      </main>
      <div
        data-stress-toggle=""
        style={{
          "align-items": "center",
          bottom: "8px",
          "flex-wrap": "wrap",
          display: "flex",
          "font-family": "system-ui, sans-serif",
          "font-size": "12px",
          gap: "6px",
          "justify-content": "center",
          left: "50%",
          "max-width": "calc(100vw - 16px)",
          position: "fixed",
          transform: "translateX(-50%)",
          "z-index": "2147483647",
        }}
      >
        <button
          type="button"
          aria-expanded={open() ? "true" : "false"}
          onClick={() => {
            setOpen(!open());
          }}
          style={{
            background: "#e5e5e5",
            border: "none",
            "border-radius": "999px",
            color: "#111",
            cursor: "pointer",
            font: "inherit",
            padding: "6px 10px",
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

export default function Stress() {
  return import.meta.env.DEV ? <StressPage /> : <NotFound />;
}
