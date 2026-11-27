import { captureArtifact } from "@solidjs/diagnostics";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { calculateRoundScore } from "../game/cards";
import type { RoomView } from "../game/protocol";
import type { RoomConnection } from "../lib/room-connection";
import { chatControls } from "../test/chat";
import { itemAt } from "../test/item-at";
import { mockMatchMedia } from "../test/match-media";
import { LOGGED_AT, room } from "../test/room-view";
import { agent, Table } from "../test/table";

const outcome = (text: string) => (_: string, element: Element | null) =>
  element?.classList.contains("log-outcome") === true &&
  element.textContent === text;

const withBot = (overrides: Partial<RoomView> = {}) => {
  const view = room(overrides);
  const [ana, ben] = [itemAt(view.players, 0), itemAt(view.players, 1)];
  view.players = [ana, { ...ben, avatar: null, bot: true, name: "Torch" }];

  return view;
};

const entries = () =>
  agent
    .snapshot()
    .filter((entry) => entry.offPage !== true && entry.component !== "more");

const spectator = () => ({
  join: {
    error: "",
    joining: false,
    onEdit: vi.fn<() => void>(),
    onJoin: vi.fn<(name: string, avatar: number) => void>(),
    savedAvatar: null,
    savedName: "",
    unavailable: false,
  },
  onLeave: vi.fn<() => void>(),
});

const benChat = (id: number, text: string) => ({
  at: LOGGED_AT,
  from: { avatar: 1, id: "b", name: "Ben" },
  game: 1,
  id,
  round: 1,
  text,
});

describe("<Table />", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sets held action cards beside the deck, not in the seat", () => {
    render(() => (
      <Table
        room={room({
          flips: [{ remaining: 1, targetId: "b" }],
          held: [{ card: { id: 9, kind: "freeze" }, ownerId: "b" }],
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    const pile = screen.getByRole("list", {
      name: "Held for Ben until the Flip Three ends",
    });

    expect(pile.closest("[data-action-bar]")).not.toBeNull();
    expect(within(pile).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(screen.getByRole("article", { name: /^Ben,/u })).queryByText(
        /held/iu
      )
    ).toBeNull();
  });

  it("keeps table lists and Flip Three pips stable across playback updates", async () => {
    const [view, setView] = createSignal(
      room({ flips: [{ remaining: 3, targetId: "b" }] })
    );

    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    const { artifact } = await captureArtifact(
      () => {
        setView(
          room({ deckCount: 79, flips: [{ remaining: 2, targetId: "b" }] })
        );
        flush();
        setView(
          room({ deckCount: 78, flips: [{ remaining: 1, targetId: "b" }] })
        );
        flush();
      },
      {
        attribution: {
          log: false,
          unstableMemos: 1,
        },
        scenario: "table-flip-three-playback",
      }
    );

    expect(
      artifact.diagnostics.filter(
        (event) =>
          event.code === "UNSTABLE_MEMO_OUTPUT" &&
          event.ownerPath?.includes("<Repeat>") === true
      )
    ).toStrictEqual([]);
    expect(
      artifact.attribution?.reruns.filter(
        (run) =>
          run.nodeName === "roundPoints" ||
          (run.nodeName === "<For>" &&
            run.causes.some((cause) => cause.name === "ranked"))
      )
    ).toStrictEqual([]);
    expect(screen.getByText(", 2 of 3 flipped")).toBeInTheDocument();
  });

  it("gives spectators their own header actions instead of Leave", () => {
    render(() => (
      <Table
        room={room({ spectatorCount: 2 })}
        playerId={null}
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
        spectator={spectator()}
      />
    ));

    expect(
      screen.getByRole("button", { name: "Join as player" })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Leave room" })).toHaveLength(
      1
    );
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(screen.getByText("2 watching")).toBeInTheDocument();
  });

  it("lets the host lock the room mid-game from the header, without the winning score", async () => {
    const send = vi.fn<RoomConnection["send"]>();
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={send}
        chat={chatControls()}
        typing={[]}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Room settings" }));

    const popover = await screen.findByRole("dialog", {
      name: "Room settings",
    });

    expect(
      within(popover).queryByRole("radiogroup", { name: "Winning score" })
    ).toBeNull();

    fireEvent.click(
      within(popover).getByRole("switch", { name: /Lock room/u })
    );
    expect(send).toHaveBeenCalledExactlyOnceWith({
      locked: true,
      type: "configure",
    });
  });

  it("shows a confirmed bot speed in settings while the deal plays back", async () => {
    render(() => (
      <Table
        room={withBot()}
        latestRoom={withBot({
          settings: { botSpeed: "fast", locked: false, targetScore: 200 },
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
        actionsDisabled
        playback={{ dealing: true }}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Room settings" }));

    const popover = await screen.findByRole("dialog", {
      name: "Room settings",
    });

    expect(within(popover).getByRole("radio", { name: "Fast" })).toBeChecked();
  });

  it("offers invite, settings, and leave from the phone menu", async () => {
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toStrictEqual(["Copy invite link", "Room settings", "Leave room"]);

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Room settings" })
    );

    const settings = await screen.findByRole("dialog", {
      name: "Room settings",
    });

    await vi.waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(settings).toBeVisible();
    expect(settings.contains(document.activeElement)).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Leave room",
      })
    );

    await expect(
      screen.findByRole("alertdialog", { name: "Leave this room?" })
    ).resolves.toBeVisible();
  });

  it("leaves room settings out of a guest's phone menu and lets them leave during the deal", async () => {
    render(() => (
      <Table
        room={room()}
        playerId="b"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
        actionsDisabled
        playback={{ dealing: true }}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: "Room settings" })
    ).toBeNull();
    expect(
      within(menu).getByRole("menuitem", { name: "Leave room" })
    ).not.toHaveAttribute("aria-disabled");
  });

  it("keeps room settings away from guests", () => {
    render(() => (
      <Table
        room={room()}
        playerId="b"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    expect(screen.queryByRole("button", { name: "Room settings" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy invite link" })
    ).toHaveTextContent("Invite");
  });

  it("opens the Scores sheet during play and returns focus on close", async () => {
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    const scores = screen.getByRole("button", { name: "Scores" });
    scores.focus();

    const scoresButton = agent
      .snapshot()
      .find(
        (entry) => entry.label === "Scores" && entry.actions.includes("press")
      );

    assert.exists(scoresButton);

    const result = await agent.act({
      steps: [{ action: "press", ref: scoresButton.ref }],
    });

    expect(result.error).toBeUndefined();
    const sheet = await screen.findByRole("dialog", { name: "Scores" });
    const standings = within(sheet).getByRole("table", { name: "Scores" });
    expect(
      within(standings).getByRole("cell", { name: "7 points, in play" })
    ).toHaveTextContent("+7");

    within(sheet).getByRole("button", { name: "Close" }).click();
    flush();
    expect(screen.queryByRole("dialog", { name: "Scores" })).toBeNull();
    expect(scores).toHaveFocus();
  });

  it.each([
    { layout: "beside the table", sheet: false },
    { layout: "in the sheet", sheet: true },
    { layout: "when matchMedia is absent", sheet: undefined },
  ])("renders the Chat & Log once when it shows $layout", ({ sheet }) => {
    if (sheet !== undefined) {
      // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
      vi.stubGlobal("matchMedia", () => ({ matches: sheet }));
    }

    try {
      render(() => (
        <Table
          room={room()}
          playerId="a"
          send={vi.fn<RoomConnection["send"]>()}
          chat={chatControls()}
          typing={[]}
        />
      ));
      flush();

      expect(document.querySelectorAll(".log-scroll")).toHaveLength(1);
      expect(document.querySelectorAll(".leaderboard")).toHaveLength(
        sheet === true ? 0 : 1
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens the Scores sheet once per round end and lists busted players", async () => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("width < 64rem"),
    }));

    try {
      const initial = room();

      const [ana, ben] = [
        itemAt(initial.players, 0),
        itemAt(initial.players, 1),
      ];

      const [view, setView] = createSignal(initial);
      render(() => (
        <Table
          room={view()}
          playerId="a"
          send={vi.fn<RoomConnection["send"]>()}
          chat={chatControls()}
          typing={[]}
        />
      ));

      const result = room({
        phase: "roundOver",
        players: [
          {
            ...ana,
            lastRound: calculateRoundScore(ana.hand),
            score: 47,
            status: "stayed",
          },
          { ...ben, status: "busted" },
        ],
      });

      setView(result);
      flush();

      const scores = within(
        await screen.findByRole("dialog", { name: "Scores" })
      );

      expect(scores.getByRole("cell", { name: "47" })).toBeVisible();
      expect(scores.getByRole("rowheader", { name: "Ben" })).toBeVisible();
      scores.getByRole("button", { name: "Close" }).click();
      setView({ ...result, deckCount: 79 });
      flush();
      expect(screen.queryByRole("dialog", { name: "Scores" })).toBeNull();
      expect(screen.getByRole("button", { name: "Scores" })).toBeVisible();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("crowns the host's seat and names the host while guests wait", () => {
    render(() => (
      <Table
        room={room({ phase: "roundOver" })}
        playerId="b"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    expect(
      within(screen.getByRole("article", { name: "Ana, 40 points" })).getByText(
        "Host"
      )
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("article", { name: "Ben, 12 points" })
      ).queryByText("Host")
    ).toBeNull();
    expect(
      screen.getByText("Waiting for Ana to start the next round.")
    ).toBeInTheDocument();
  });

  it("animates both round-score displays toward the points they receive", () => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
    }));
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });

    try {
      const [state, setState] = createSignal(room());

      const [points, setPoints] = createSignal(0);

      render(() => (
        <Table
          room={state()}
          playerId="a"
          send={vi.fn<RoomConnection["send"]>()}
          chat={chatControls()}
          typing={[]}
          playback={{
            roundPoints: new Map([
              ["a", points()],
              ["b", 3],
            ]),
          }}
        />
      ));

      const seat = within(
        screen.getByRole("article", { name: "Ana, 40 points" })
      );

      const meters = seat.getByRole("meter", { name: "Total score" });
      const scoreTable = within(screen.getByRole("table", { name: "Scores" }));

      const shown = (label: string) => {
        const seatPoints =
          meters.querySelector("[data-projected]")?.textContent;

        const roundCell = scoreTable.getByRole("cell", { name: label });

        return [Number(seatPoints), Number(roundCell.textContent)] as const;
      };

      setPoints(7);
      flush();
      vi.advanceTimersByTime(64);
      flush();

      const [seatPoints, roundPoints] = shown("7 points, in play");
      expect({
        matched: seatPoints === roundPoints,
        inMotion: seatPoints > 0 && seatPoints < 7,
      }).toStrictEqual({
        matched: true,
        inMotion: true,
      });

      setState(
        room({
          players: state().players.map((player) =>
            player.id === "a" ? { ...player, status: "busted" } : player
          ),
        })
      );
      setPoints(0);
      flush();
      expect(shown("0 points, busted")).toStrictEqual([seatPoints, seatPoints]);

      vi.advanceTimersByTime(64);
      flush();
      const [decreasing] = shown("0 points, busted");
      expect(decreasing).toBeLessThan(seatPoints);

      vi.advanceTimersByTime(320);
      flush();
      expect(shown("0 points, busted")).toStrictEqual([0, 0]);
    } finally {
      cleanup();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("keeps the deck through deal playback and highlights the game winner", () => {
    const [dealing, setDealing] = createSignal(true);
    const view = room({ phase: "gameOver", winnerIds: ["b"] });

    render(() => (
      <Table
        room={view}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
        playback={{ dealing: dealing() }}
      />
    ));

    const actionBar = within(
      screen.getByRole("region", { name: "Game status" })
    );

    expect(actionBar.getByText("cards left in the deck")).toBeInTheDocument();

    setDealing(false);
    flush();

    expect(
      screen.getByRole("article", { name: "Ben, 12 points" })
    ).toHaveAttribute("data-winner");
    expect(
      screen.getByRole("article", { name: "Ana, 40 points" })
    ).not.toHaveAttribute("data-winner");
    expect(actionBar.getByText("Ben wins!")).toBeVisible();
    expect(actionBar.queryByText("cards left in the deck")).toBeNull();
  });

  it("an agent can find every control and hit on its turn", async () => {
    const send = vi.fn<RoomConnection["send"]>();
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={send}
        chat={chatControls()}
        typing={[]}
      />
    ));

    const unnamed = entries()
      .filter((entry) => entry.label === "")
      .map((entry) => `${entry.component} ${entry.ref}`);

    expect(unnamed).toStrictEqual([]);

    const labels = entries().map((entry) => entry.label);
    expect(labels).toStrictEqual(
      expect.arrayContaining(["Hit", "Stay", "Copy invite link", "Leave room"])
    );

    const result = await agent.act({
      steps: [{ action: "press", ref: "Hit" }],
    });

    expect(result.error).toBeUndefined();
    expect(result.ok).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ type: "hit" });
  });

  it("sends a chat message and shows chat in the game log", async () => {
    const chat = chatControls();
    render(() => (
      <Table
        room={room({
          log: [
            {
              at: LOGGED_AT,
              game: 1,
              id: 1,
              round: 1,
              event: { dealer: { id: "b", name: "Ben" }, type: "roundStarted" },
            },
            {
              at: LOGGED_AT,
              from: { avatar: 1, id: "b", name: "Ben" },
              game: 1,
              id: 2,
              round: 1,
              text: "gl",
            },
          ],
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chat}
        typing={[]}
      />
    ));

    const log = screen.getByRole("log", { name: "Chat & Log" });
    expect(
      within(log).getByText("Ben", { selector: ".log-author" })
    ).toBeTruthy();
    expect(within(log).getByText("gl")).toBeTruthy();

    const result = await agent.act({
      steps: [
        { action: "setValue", args: ["  you too "], ref: "Chat message" },
        { action: "press", ref: "Send" },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(chat.sent).toStrictEqual(["you too"]);
  });

  it("groups old game events by clock minute and keeps per-message timestamps", () => {
    const at = (Math.floor(Date.now() / 60_000) - 120) * 60_000;
    render(() => (
      <Table
        room={room({
          log: [
            {
              at,
              game: 1,
              id: 2,
              round: 1,
              event: { dealer: { id: "b", name: "Ben" }, type: "roundStarted" },
            },
            {
              at,
              game: 1,
              id: 3,
              round: 1,
              event: {
                card: 6,
                player: { id: "b", name: "Ben" },
                type: "busted",
              },
            },
            {
              at: at + 1000,
              game: 1,
              id: 4,
              round: 1,
              event: {
                by: { kind: "player" },
                player: { id: "a", name: "Ana" },
                points: 44,
                type: "stayed",
              },
            },
            {
              at: at + 2000,
              game: 1,
              id: 5,
              round: 2,
              event: {
                by: { id: "b", name: "Ben" },
                points: 26,
                target: { id: "a", name: "Ana" },
                type: "frozen",
              },
            },
            {
              at: at + 3000,
              game: 1,
              id: 6,
              round: 2,
              event: {
                by: { id: "b", name: "Ben" },
                card: "flipThree",
                target: { id: "a", name: "Ana" },
                type: "actionAssigned",
              },
            },
            {
              at: at + 4000,
              game: 1,
              id: 7,
              round: 2,
              event: {
                player: { id: "b", name: "Ben" },
                type: "secondChanceKept",
              },
            },
            {
              at: at + 60_000,
              from: { avatar: 1, id: "b", name: "Ben" },
              game: 1,
              id: 8,
              round: 2,
              text: "Good round",
            },
            {
              at: at + 61_000,
              from: { avatar: 1, id: "a", name: "Ana" },
              game: 1,
              id: 9,
              round: 2,
              text: "Thanks!",
            },
            {
              at: at + 62_000,
              game: 1,
              id: 10,
              round: 2,
              event: { scores: [], tiedAt: null, type: "roundOver" },
            },
            {
              at: at + 62_000,
              game: 1,
              id: 11,
              round: 2,
              event: { type: "deckReshuffled" },
            },
            {
              at: at + 62_000,
              game: 1,
              id: 12,
              round: 2,
              event: {
                player: { id: "b", name: "Ben" },
                points: 202,
                scores: [],
                type: "gameWon",
              },
            },
          ],
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    const log = within(screen.getByRole("log", { name: "Chat & Log" }));
    fireEvent.click(log.getByRole("button", { name: "Round 2" }));
    flush();

    const rows = log.getAllByRole("listitem").map((row) => {
      const time = within(row).queryByRole("time");

      return {
        announcement: row.querySelector("[data-announcement]") !== null,
        about: [],
        at: time?.getAttribute("datetime"),
        text: row.textContent
          ?.replace(time?.textContent ?? "", "")
          .replaceAll("\u00A0", " "),
      };
    });

    expect(rows.map((row) => row.at)).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new Date(at + 60_000).toISOString(),
      new Date(at + 61_000).toISOString(),
      new Date(at + 60_000).toISOString(),
      undefined,
      undefined,
    ]);
    expect(
      log.getAllByRole("heading").map((heading) => heading.textContent)
    ).toStrictEqual(["Round 1", "Round 2"]);
    expect(
      log.getAllByRole("time").map((time) => time.getAttribute("datetime"))
    ).toStrictEqual([
      new Date(at).toISOString(),
      new Date(at).toISOString(),
      new Date(at + 60_000).toISOString(),
      new Date(at + 61_000).toISOString(),
      new Date(at + 60_000).toISOString(),
    ]);
    expect(rows.slice(0, 6).map((row) => row.text)).toStrictEqual([
      "Ben deals.",
      "Ben busted · duplicate 6",
      "Ana stayed +44 points",
      "Ana was frozen +26 points · by Ben",
      "Ben assigned Flip Three · to Ana",
      "Ben got a Second Chance",
    ]);
    expect(
      rows.filter((row) => row.announcement).map((row) => row.text)
    ).toStrictEqual([
      "Ben deals.",
      "Round 2 is over.",
      "Deck rebuilt from the discard pile.",
    ]);
  });

  it("updates relative times on game events and chat messages", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });

    try {
      const at = Date.now();
      render(() => (
        <Table
          room={room({
            log: [
              {
                at,
                game: 1,
                id: 1,
                round: 1,
                event: {
                  dealer: { id: "b", name: "Ben" },
                  type: "roundStarted",
                },
              },
              {
                at,
                from: { avatar: 1, id: "b", name: "Ben" },
                game: 1,
                id: 2,
                round: 1,
                text: "Good luck!",
              },
            ],
          })}
          playerId="a"
          send={vi.fn<RoomConnection["send"]>()}
          chat={chatControls()}
          typing={[]}
        />
      ));

      const log = within(screen.getByRole("log", { name: "Chat & Log" }));
      const times = log.getAllByRole("time");
      const labels = () => times.map((time) => time.textContent);

      expect(labels()).toStrictEqual(["now", "now"]);

      vi.advanceTimersByTime(2000);
      flush();
      expect(labels()).toStrictEqual(["2s", "2s"]);

      vi.advanceTimersByTime(58_000);
      flush();
      expect(labels()).toStrictEqual(["1m", "1m"]);

      vi.setSystemTime(at + 3_540_000);
      vi.advanceTimersByTime(60_000);
      flush();

      const clock = new Intl.DateTimeFormat(undefined, {
        timeStyle: "short",
      }).format(at);

      expect(
        log.getAllByRole("time").map((time) => time.textContent)
      ).toStrictEqual([clock, clock]);
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("filters activity and counts incoming chat while Game is selected", async () => {
    const [view, setView] = createSignal(room());
    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    const filters = within(
      screen.getByRole("radiogroup", { name: "Filter activity" })
    );

    expect(
      filters.getByRole("radio", { name: "All", checked: true })
    ).toBeVisible();

    filters.getByRole("radio", { name: "Game" }).click();
    flush();

    setView(
      room({
        log: [
          ...view().log,
          {
            at: LOGGED_AT,
            from: { avatar: 1, id: "b", name: "Ben" },
            game: 1,
            id: 2,
            round: 1,
            text: "gl",
          },
          {
            at: LOGGED_AT,
            from: { avatar: 1, id: "a", name: "Ana" },
            game: 1,
            id: 3,
            round: 1,
            text: "you too",
          },
        ],
      })
    );
    flush();

    const log = within(screen.getByRole("log", { name: "Chat & Log" }));
    const unread = screen.getByRole("status", { name: "Unread chat messages" });
    expect({
      chatFilter: filters.queryByRole("radio", { name: "Chat, 1 unread" })
        ?.textContent,
      hiddenMessage: log.queryByText("gl"),
      unread: unread.textContent,
    }).toStrictEqual({
      chatFilter: "Chat1",
      hiddenMessage: null,
      unread: "1 unread message",
    });

    await agent.act({
      steps: [{ action: "setValue", args: ["Chat"], ref: "Filter activity" }],
    });

    expect(
      filters.getByRole("radio", { name: "Chat", checked: true })
    ).toBeVisible();
    expect({
      gameEvent: log.queryByText(outcome("Ben deals.")),
      unread: unread.textContent,
    }).toStrictEqual({
      gameEvent: null,
      unread: "",
    });

    filters.getByRole("radio", { name: "All" }).click();
    flush();
    expect(log.getByText(outcome("Ben deals."))).toBeVisible();
  });

  it("keeps the scroll position and counts new entries until jumping to latest", async () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
    const resizeCallbacks = new Map<Element, () => void>();
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- Deliver layout changes that jsdom cannot measure.
    vi.stubGlobal(
      "ResizeObserver",
      class extends ResizeObserver {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- ResizeObserver delivers a callback.
        constructor(callback: ResizeObserverCallback) {
          super(callback);
          this.observe = (element) => {
            resizeCallbacks.set(element, () => {
              // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Deliver the ResizeObserver notification.
              callback([], this);
            });
          };
        }
      }
    );
    const [view, setView] = createSignal(room());
    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    const log = screen.getByRole("log", { name: "Chat & Log" });
    const unread = screen.getByRole("status", { name: "Unread chat messages" });
    Object.defineProperties(log, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 500 },
    });
    log.scrollTop = 300;
    fireEvent.scroll(log);
    vi.advanceTimersToNextFrame();
    log.scrollTop = 100;
    fireEvent.scroll(log);
    vi.advanceTimersToNextFrame();
    await Promise.resolve();
    flush();

    setView(
      room({
        log: [
          ...view().log,
          {
            at: LOGGED_AT,
            game: 1,
            id: 2,
            round: 1,
            event: {
              by: { kind: "player" },
              player: { id: "b", name: "Ben" },
              points: 0,
              type: "stayed",
            },
          },
          {
            at: LOGGED_AT,
            game: 1,
            id: 3,
            round: 1,
            event: { dealer: { id: "a", name: "Ana" }, type: "roundStarted" },
          },
          {
            at: LOGGED_AT,
            from: { avatar: 1, id: "b", name: "Ben" },
            game: 1,
            id: 4,
            round: 1,
            text: "Good luck!",
          },
          {
            at: LOGGED_AT,
            from: { avatar: 1, id: "a", name: "Ana" },
            game: 1,
            id: 5,
            round: 1,
            text: "Thanks!",
          },
        ],
      })
    );
    flush();

    vi.advanceTimersToNextFrame();
    expect({
      after: !Object.hasOwn(log.dataset, "atYEnd"),
      before: !Object.hasOwn(log.dataset, "atYStart"),
      top: log.scrollTop,
      unread: unread.textContent,
    }).toStrictEqual({
      after: true,
      before: true,
      top: 100,
      unread: "1 unread message",
    });
    const jump = screen.getByRole("button", { name: "Jump to latest · 4 new" });
    jump.click();
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    flush();

    expect({
      following: Object.hasOwn(log.dataset, "sticking"),
      jumpShown: Object.hasOwn(jump.dataset, "visible"),
    }).toStrictEqual({ following: true, jumpShown: false });

    setView(
      room({
        log: [
          ...view().log,
          {
            at: LOGGED_AT,
            from: { avatar: 1, id: "b", name: "Ben" },
            game: 1,
            id: 6,
            round: 1,
            text: "Nice hand.",
          },
        ],
      })
    );
    flush();
    Object.defineProperty(log, "scrollHeight", { value: 600 });
    resizeCallbacks.get(log)?.();
    vi.advanceTimersToNextFrame();
    expect({
      following: Object.hasOwn(log.dataset, "sticking"),
      top: log.scrollTop,
      unread: unread.textContent,
    }).toStrictEqual({
      following: true,
      top: 400,
      unread: "",
    });

    log.scrollTop = 0;
    fireEvent.scroll(log);
    vi.advanceTimersToNextFrame();
    await Promise.resolve();
    flush();
    expect(jump).toHaveAttribute("data-visible");

    Object.defineProperty(log, "clientHeight", { value: 600 });
    resizeCallbacks.get(log)?.();
    vi.advanceTimersToNextFrame();
    await Promise.resolve();
    flush();
    expect({
      jumpShown: Object.hasOwn(jump.dataset, "visible"),
      top: log.scrollTop,
    }).toStrictEqual({ jumpShown: false, top: 0 });
  });

  it("marks the score edges that have more rows to scroll to", () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
    });
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    const scores = screen.getByRole("region", { name: "Scores" });
    expect(scores).toHaveAttribute("data-at-y-end");

    Object.defineProperties(scores, {
      clientHeight: { value: 120 },
      scrollHeight: { value: 300 },
    });
    fireEvent.scroll(scores);
    vi.advanceTimersToNextFrame();
    expect(scores).toHaveAttribute("data-at-y-start");
    expect(scores).not.toHaveAttribute("data-at-y-end");

    scores.scrollTop = 180;
    fireEvent.scroll(scores);
    vi.advanceTimersToNextFrame();
    expect(scores).not.toHaveAttribute("data-at-y-start");
    expect(scores).toHaveAttribute("data-at-y-end");
  });

  it("lets a player leave during the deal", async () => {
    const sent = Promise.withResolvers<Parameters<RoomConnection["send"]>[0]>();

    const send: RoomConnection["send"] = async (command) => {
      sent.resolve(command);

      return await Promise.resolve(true);
    };

    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={send}
        chat={chatControls()}
        typing={[]}
        actionsDisabled
        playback={{ dealing: true }}
      />
    ));
    const leave = screen.getByRole("button", { name: "Leave room" });
    expect(leave).not.toHaveAttribute("aria-disabled");
    leave.click();
    flush();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));
    await expect(sent.promise).resolves.toStrictEqual({ type: "leave" });
  });

  it("keeps Leave room focusable with a reason while offline", () => {
    const [offline, setOffline] = createSignal(true);

    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
        offline={offline()}
      />
    ));
    const leave = screen.getByRole("button", { name: "Leave room" });
    expect(leave).toHaveAttribute("aria-disabled", "true");
    expect(leave).toHaveAccessibleDescription(
      "You can leave once you're back online"
    );
    leave.click();
    flush();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    setOffline(false);
    flush();
    expect(leave).not.toHaveAttribute("aria-disabled");
    expect(leave).not.toHaveAccessibleDescription(
      "You can leave once you're back online"
    );
  });

  it("prompts the chooser and dims players who cannot receive the card", () => {
    const view = room({
      choice: {
        card: { id: 9, kind: "freeze" },
        chooserId: "a",
        options: ["a"],
      },
    });

    const ben = view.players.find((player) => player.id === "b");

    if (ben) {
      ben.status = "busted";
    }

    render(() => (
      <Table
        room={view}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    expect(screen.getByText(/Who gets your Freeze/u)).toBeVisible();
    expect(screen.getByText("Tap a player")).toBeVisible();
    expect(
      screen.getByRole("article", { name: "Ana, 40 points" })
    ).toHaveAttribute("data-pickable", "freeze");
    expect(
      screen.getByRole("article", { name: "Ben, 12 points" })
    ).toHaveAttribute("data-unpickable");
  });

  it("clears the unread count when the chat sheet opens and returns focus on close", async () => {
    mockMatchMedia(true);

    const [view, setView] = createSignal(room());

    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    const toggle = screen.getByRole("button", { name: "Chat & Log" });
    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");

    setView(
      room({
        log: [
          {
            at: LOGGED_AT,
            game: 1,
            id: 1,
            round: 1,
            event: { dealer: { id: "b", name: "Ben" }, type: "roundStarted" },
          },
          {
            at: LOGGED_AT,
            from: { avatar: 1, id: "b", name: "Ben" },
            game: 1,
            id: 2,
            round: 1,
            text: "gl",
          },
          {
            at: LOGGED_AT,
            from: { avatar: 1, id: "a", name: "Ana" },
            game: 1,
            id: 3,
            round: 1,
            text: "you too",
          },
        ],
      })
    );
    flush();

    expect(toggle).toHaveAccessibleName("Chat & Log, 1 new message");

    toggle.focus();
    toggle.click();
    flush();

    const sheet = await screen.findByRole("dialog", {
      name: "Chat & Log",
    });

    expect(toggle).toHaveAccessibleName("Chat & Log");
    within(sheet).getByRole("button", { name: "Close" }).click();
    flush();
    expect(screen.queryByRole("dialog", { name: "Chat & Log" })).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it.each([
    ["keeps previously visible chat read", false, "Chat & Log"],
    [
      "keeps chat arriving with round end unread",
      true,
      "Chat & Log, 1 new message",
    ],
  ])(
    "%s when Scores replaces the open sheet",
    async (_, arrivesAtRoundEnd, label) => {
      // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("width < 64rem"),
      }));

      try {
        const [view, setView] = createSignal(room());

        render(() => (
          <Table
            room={view()}
            playerId="a"
            send={vi.fn<RoomConnection["send"]>()}
            chat={chatControls()}
            typing={[]}
          />
        ));

        const toggle = screen.getByRole("button", { name: "Chat & Log" });
        toggle.click();
        flush();
        const sheet = await screen.findByRole("dialog", { name: "Chat & Log" });

        setView(room({ log: [benChat(1, "gl")] }));
        flush();
        await within(sheet).findByText("gl");
        await waitFor(() => {
          expect(within(sheet).getByRole("log")).toHaveAttribute(
            "data-at-y-end"
          );
        });

        const chatted = room({
          log: [benChat(1, "gl"), benChat(2, "nice hit")],
        });

        if (!arrivesAtRoundEnd) {
          setView(chatted);
          flush();
          await within(sheet).findByText("nice hit");
        }

        setView({ ...chatted, phase: "roundOver" });
        flush();

        await screen.findByRole("dialog", { name: "Scores" });
        expect(screen.queryByRole("dialog", { name: "Chat & Log" })).toBeNull();
        expect(toggle).toHaveAccessibleName(label);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  );

  it.each([9, 10])(
    "counts replacement chat after restoring the log to entry %i",
    (id) => {
      mockMatchMedia(true);
      const retained = benChat(id - 1, "retained");
      const original = [retained, benChat(id, "original")];

      if (id === 9) {
        original.push(benChat(10, "lost in restore"));
      }

      const [view, setView] = createSignal(room({ log: original }));
      render(() => (
        <Table
          room={view()}
          playerId="a"
          send={vi.fn<RoomConnection["send"]>()}
          chat={chatControls()}
          typing={[]}
        />
      ));

      const toggle = screen.getByRole("button", { name: "Chat & Log" });
      const restored = [{ ...retained }, benChat(id, "replacement")];
      setView(room({ log: restored }));
      flush();

      expect(toggle).toHaveAccessibleName("Chat & Log, 1 new message");

      setView(room({ log: [...restored, benChat(id + 1, "new chat")] }));
      flush();

      expect(toggle).toHaveAccessibleName("Chat & Log, 2 new messages");
    }
  );

  it("keeps chat unread when the sheet closes during a jump to latest", async () => {
    mockMatchMedia(true);

    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });

    const [view, setView] = createSignal(
      room({ log: [benChat(1, "first chat")] })
    );

    render(() => (
      <Table
        room={view()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));

    const toggle = screen.getByRole("button", { name: "Chat & Log" });
    toggle.click();
    flush();

    const sheet = await screen.findByRole("dialog", { name: "Chat & Log" });
    const log = within(sheet).getByRole("log");
    Object.defineProperties(log, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1000 },
    });

    log.scrollTop = 800;
    fireEvent.scroll(log);
    vi.advanceTimersToNextFrame();
    log.scrollTop = 100;
    fireEvent.scroll(log);
    vi.advanceTimersToNextFrame();
    await Promise.resolve();
    flush();

    setView(
      room({ log: [benChat(1, "first chat"), benChat(2, "unread chat")] })
    );
    flush();
    expect(toggle).toHaveAccessibleName("Chat & Log, 1 new message");

    within(sheet)
      .getByRole("button", { name: /Jump to latest/u })
      .click();
    flush();

    expect(log).toHaveAttribute("data-sticking");
    expect(log).not.toHaveAttribute("data-at-y-end");
    within(sheet).getByRole("button", { name: "Close" }).click();
    flush();

    expect(toggle).toHaveAccessibleName("Chat & Log, 1 new message");
  });

  it("keeps the chat draft after dismissing the sheet with Escape", async () => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));

    try {
      render(() => (
        <Table
          room={room()}
          playerId="a"
          send={vi.fn<RoomConnection["send"]>()}
          chat={chatControls()}
          typing={[]}
        />
      ));
      flush();

      const toggle = screen.getByRole("button", { name: "Chat & Log" });
      toggle.focus();
      toggle.click();

      const sheet = await screen.findByRole("dialog", {
        name: "Chat & Log",
      });

      const input = within(sheet).getByRole("textbox", {
        name: "Chat message",
      });

      fireEvent.input(input, { target: { value: "See you next round" } });
      flush();

      fireEvent.keyDown(input, { key: "Escape" });
      flush();
      expect(toggle).toHaveFocus();

      toggle.click();

      const reopened = await screen.findByRole("dialog", {
        name: "Chat & Log",
      });

      expect(
        within(reopened).getByRole("textbox", { name: "Chat message" })
      ).toHaveValue("See you next round");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closes the chat sheet on resize and keeps one log with the same draft", async () => {
    const resize = mockMatchMedia(true);
    render(() => (
      <Table
        room={room()}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));
    screen.getByRole("button", { name: "Chat & Log" }).click();
    flush();

    const sheet = await screen.findByRole("dialog", { name: "Chat & Log" });
    fireEvent.input(
      within(sheet).getByRole("textbox", { name: "Chat message" }),
      {
        target: { value: "Good game" },
      }
    );
    flush();

    resize(false);
    flush();

    expect(screen.queryByRole("dialog", { name: "Chat & Log" })).toBeNull();
    expect(document.querySelectorAll(".log-scroll")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Chat message" })).toHaveValue(
      "Good game"
    );

    resize(true);
    flush();
    expect(screen.queryByRole("dialog", { name: "Chat & Log" })).toBeNull();
  });

  it("other players see whose turn it is, not the Hit button", () => {
    render(() => (
      <Table
        room={room()}
        playerId="b"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));
    const seat = screen.getByRole("article", { name: "Ana, 40 points" });
    expect(within(seat).getByText("Thinking…")).toBeVisible();
    expect(screen.getByText("Ana is deciding…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Options for/u })).toBeNull();
  });

  it("names later games in the log's round headings", () => {
    render(() => (
      <Table
        room={room({
          log: [
            {
              at: LOGGED_AT,
              game: 1,
              id: 1,
              round: 1,
              event: { dealer: { id: "b", name: "Ben" }, type: "roundStarted" },
            },
            {
              at: LOGGED_AT,
              game: 1,
              id: 2,
              round: 0,
              event: {
                player: { id: "c", name: "Cal" },
                type: "joined",
                waitsFor: null,
              },
            },
            {
              at: LOGGED_AT,
              game: 2,
              id: 3,
              round: 1,
              event: { dealer: { id: "a", name: "Ana" }, type: "roundStarted" },
            },
          ],
        })}
        playerId="a"
        send={vi.fn<RoomConnection["send"]>()}
        chat={chatControls()}
        typing={[]}
      />
    ));
    const log = screen.getByRole("log");
    expect(
      within(log)
        .getAllByRole("heading")
        .map((heading) => heading.textContent)
    ).toStrictEqual(["Round 1", "Before the game", "Game 2 · Round 1"]);
  });
});
