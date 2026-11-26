import { expectNoDiagnostics } from "@solidjs/diagnostics";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseClientMessage } from "../game/client-message";
import type { ChatEntry, EventEntry, LogEntry } from "../game/engine";
import { CHAT_TEXT_LIMIT } from "../game/text";
import { createChatLogReads } from "../lib/chat-log-reads";
import { chatControls } from "../test/chat";
import { captureScenario } from "../test/diagnostics";
import { itemAt } from "../test/item-at";
import GameLog, { ChatLog } from "./game-log";

const entries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    at: 0,
    event: {
      by: { kind: "player" },
      player: { id: `p${index}`, name: `Player ${index}` },
      points: index + 1,
      type: "stayed",
    },
    game: 1,
    id: index + 1,
    round: 1,
  })) satisfies LogEntry[];

const ana = { avatar: 1, id: "a", name: "Ana" };
const ben = { avatar: 2, id: "b", name: "Ben" };
const players = [ana, ben];
const anaNamed = { id: ana.id, name: ana.name };
const benNamed = { id: ben.id, name: ben.name };

const twoRounds = () => {
  const cues: (
    | Pick<ChatEntry, "from" | "round" | "text">
    | Pick<EventEntry, "event" | "round">
  )[] = [
    {
      event: {
        by: { kind: "player" },
        player: anaNamed,
        points: 12,
        type: "stayed",
      },
      round: 1,
    },
    { event: { card: 9, player: benNamed, type: "busted" }, round: 1 },
    { from: ben, round: 1, text: "ouch" },
    {
      event: {
        scores: [
          { ...anaNamed, points: 12 },
          { ...benNamed, points: 0 },
        ],
        tiedAt: null,
        type: "roundOver",
      },
      round: 1,
    },
    { event: { dealer: anaNamed, type: "roundStarted" }, round: 2 },
    {
      event: {
        by: { kind: "player" },
        player: benNamed,
        points: 30,
        type: "stayed",
      },
      round: 2,
    },
  ];

  const log: LogEntry[] = cues.map((entry, index) => ({
    at: Date.now(),
    game: 1,
    id: index + 1,
    ...entry,
  }));

  return log;
};

const fields = (id: number, at: number) => ({ at, game: 1, id, round: 1 });

const withoutTimes = (row: HTMLElement) => {
  const copy = row.cloneNode(true);

  if (!(copy instanceof HTMLElement)) {
    return "";
  }

  for (const time of copy.querySelectorAll("time")) {
    time.remove();
  }

  return copy.textContent.replaceAll("\u00A0", " ");
};

const rowTexts = (has?: string) =>
  screen
    .getAllByRole("listitem")
    .filter((row) => has === undefined || Object.hasOwn(row.dataset, has))
    .map(withoutTimes);

const isContinuation = (text: string) =>
  screen.getByText(text).closest("li")?.dataset.continuation !== undefined;

const charCount = () => screen.queryByText(/^\d+\/200$/u);

const stayed = (index: number) =>
  screen.getByRole("button", { name: `Player ${index}` }).closest("li");

describe("<GameLog />", () => {
  afterEach(cleanup);

  it("tells spectators why they can't chat", () => {
    render(() => (
      <GameLog log={entries(1)} playerId={null} players={players} typing={[]} />
    ));

    expect(screen.queryByRole("textbox", { name: "Chat message" })).toBeNull();
    expect(screen.getByText("Join as a player to chat.")).toBeInTheDocument();
  });

  it("groups nearby chat by player and restarts after an event or a pause", () => {
    const own = { avatar: 1, id: "p0", name: "Owen" };
    const guest = { avatar: 2, id: "p1", name: "Ben" };
    const now = Date.now();

    const log: LogEntry[] = [
      { ...fields(1, now), from: own, text: "Hello!" },
      { ...fields(2, now + 1000), from: own, text: "Good luck!" },
      { ...fields(3, now + 2000), from: guest, text: "You too!" },
      { ...fields(4, now + 3000), event: { locked: false, type: "lockSet" } },
      { ...fields(5, now + 4000), from: guest, text: "Ready?" },
      { ...fields(6, now + 64_000), from: guest, text: "Still here." },
    ];

    render(() => (
      <GameLog log={log} playerId={own.id} players={[own, guest]} typing={[]} />
    ));

    const bubbles = screen
      .getAllByRole("listitem")
      .filter((row) => row.dataset.kind === "chat");

    expect(
      bubbles.map((row) => ({
        continuation: Object.hasOwn(row.dataset, "continuation"),
        own: Object.hasOwn(row.dataset, "own"),
        author: row.querySelector(".log-author")?.textContent ?? null,
      }))
    ).toStrictEqual([
      { continuation: false, own: true, author: "Owen" },
      { continuation: true, own: true, author: null },
      { continuation: false, own: false, author: "Ben" },
      { continuation: false, own: false, author: "Ben" },
      { continuation: false, own: false, author: "Ben" },
    ]);
  });

  it("enables Send for a message and keeps the draft until a retry succeeds", () => {
    const [connected, setConnected] = createSignal(false);
    const sent: string[] = [];
    render(() => (
      <GameLog
        log={[]}
        playerId="p0"
        players={players}
        typing={[]}
        chat={chatControls((text) => {
          if (!connected()) {
            return false;
          }

          sent.push(text);

          return true;
        })}
      />
    ));

    const draft = screen.getByRole<HTMLInputElement>("textbox", {
      name: "Chat message",
    });

    const button = screen.getByRole("button", { name: "Send" });
    const feedback = screen.getByRole("status", { name: "" });
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.input(draft, { target: { value: "  " } });
    flush();
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.input(draft, { target: { value: "  Good game! " } });
    flush();
    button.click();
    flush();
    expect({
      draft: draft.value,
      feedback: feedback.textContent,
      sent,
    }).toStrictEqual({
      draft: "  Good game! ",
      feedback: "Message not sent. Try again when reconnected.",
      sent: [],
    });

    setConnected(true);
    flush();
    button.click();
    flush();
    expect(draft).toHaveValue("");
    expect({
      disabled: button.getAttribute("aria-disabled"),
      feedback: feedback.textContent,
      sent,
    }).toStrictEqual({ disabled: "true", feedback: "", sent: ["Good game!"] });
  });

  it("folds a finished round down to its chat", () => {
    render(() => (
      <GameLog log={twoRounds()} playerId="a" players={players} typing={[]} />
    ));

    const toggle = screen.getByRole("button", { name: "Round 1" });

    const folding = () => ({
      expanded: toggle.getAttribute("aria-expanded"),
      rows: rowTexts(),
    });

    expect(folding()).toStrictEqual({
      expanded: "false",
      rows: ["Benouch", "Ana deals.", "Ben stayed +30 points"],
    });
    expect(screen.queryByRole("button", { name: "Round 2" })).toBeNull();

    fireEvent.click(toggle);
    flush();

    expect(folding()).toStrictEqual({
      expanded: "true",
      rows: [
        "Ana stayed +12 points",
        "Ben busted · duplicate 9",
        "Benouch",
        "Round 1 is over.",
        "Ana deals.",
        "Ben stayed +30 points",
      ],
    });

    const panel = toggle
      .closest(".log-group")
      ?.querySelector('[data-slot="collapsible-panel"]');

    expect(panel).toHaveTextContent("Ana stayed");
    expect(toggle).toHaveAttribute("aria-controls", panel?.id);
  });

  it("stays on an unfolded round instead of following the end", async () => {
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

    try {
      render(() => (
        <GameLog log={twoRounds()} playerId="a" players={players} typing={[]} />
      ));

      const viewport = screen.getByRole("log");
      const area = viewport.closest('[data-slot="scroll-area"]');

      expect(area).toHaveAttribute("data-sticking");

      const toggle = screen.getByRole("button", { name: "Round 1" });
      Object.defineProperties(viewport, {
        clientHeight: { value: 200 },
        scrollHeight: {
          get: () =>
            toggle.getAttribute("aria-expanded") === "true" ? 700 : 500,
        },
      });
      viewport.scrollTop = 300;
      fireEvent.scroll(viewport);
      vi.advanceTimersToNextFrame();
      flush();

      fireEvent.click(toggle);
      flush();
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      fireEvent.scroll(viewport);
      vi.advanceTimersToNextFrame();
      flush();
      resizeCallbacks.get(viewport)?.();

      expect(viewport.scrollTop).toBe(300);
      expect(area).not.toHaveAttribute("data-sticking");

      viewport.scrollTop = 500;
      fireEvent.scroll(viewport);
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
      flush();

      expect(area).toHaveAttribute("data-sticking");
    } finally {
      cleanup();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("makes the last round foldable as soon as it finishes", () => {
    const [log, setLog] = createSignal(twoRounds());

    const settlement: LogEntry = {
      at: Date.now(),
      event: {
        scores: [
          { ...anaNamed, points: 0 },
          { ...benNamed, points: 30 },
        ],
        tiedAt: null,
        type: "roundOver",
      },
      game: 1,
      id: log().length + 1,
      round: 2,
    };

    render(() => (
      <GameLog log={log()} playerId="a" players={players} typing={[]} />
    ));

    expect(screen.queryByRole("button", { name: "Round 2" })).toBeNull();
    setLog([...log(), settlement]);
    flush();

    const toggle = screen.getByRole("button", { name: "Round 2" });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a chat run split by an event even when the event is hidden", () => {
    const log: LogEntry[] = [
      {
        at: 1000,
        game: 1,
        id: 1,
        from: ben,
        round: 1,
        text: "First",
      },
      {
        at: 2000,
        event: { scores: [], tiedAt: null, type: "roundOver" },
        game: 1,
        id: 2,
        round: 1,
      },
      {
        at: 3000,
        game: 1,
        id: 3,
        from: ben,
        round: 1,
        text: "Second",
      },
    ];

    render(() => (
      <GameLog log={log} playerId="a" players={players} typing={[]} />
    ));

    expect(isContinuation("Second")).toBeFalsy();
    fireEvent.click(screen.getByRole("radio", { name: "Chat" }));
    flush();
    expect(isContinuation("Second")).toBeFalsy();
  });

  it("puts the New marker above a folded round with the first unread event", async () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });

    try {
      const entry = {
        at: Date.now(),
        event: { dealer: benNamed, type: "roundStarted" },
        game: 1,
        round: 1,
        id: 1,
      } satisfies LogEntry;

      const [log, setLog] = createSignal<LogEntry[]>([entry]);

      render(() => (
        <GameLog log={log()} playerId="a" players={players} typing={[]} />
      ));
      const viewport = screen.getByRole("log");
      Object.defineProperties(viewport, {
        clientHeight: { value: 200 },
        scrollHeight: { value: 500 },
      });
      viewport.scrollTop = 300;
      fireEvent.scroll(viewport);
      vi.advanceTimersToNextFrame();
      viewport.scrollTop = 100;
      fireEvent.scroll(viewport);
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
      flush();

      setLog([
        entry,
        {
          ...entry,
          event: {
            scores: [{ ...benNamed, points: 8 }],
            tiedAt: null,
            type: "roundOver",
          },
          id: 2,
        },
        {
          ...entry,
          event: { dealer: anaNamed, type: "roundStarted" },
          id: 3,
          round: 2,
        },
      ]);
      flush();

      expect(
        screen.getByRole("button", { name: "Jump to latest · 2 new" })
      ).toBeVisible();

      const marker = screen.getByText("New").parentElement;
      expect(marker?.nextElementSibling).toHaveTextContent("Round 1");
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("counts unread chat on the sheet's Chat filter while scrolled up", async () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });

    try {
      const entry = {
        at: Date.now(),
        event: { dealer: benNamed, type: "roundStarted" },
        game: 1,
        round: 1,
        id: 1,
      } satisfies LogEntry;

      const [log, setLog] = createSignal<LogEntry[]>([entry]);

      render(() => {
        const reads = createChatLogReads({
          log,
          playerId: () => "a",
          shown: () => true,
        });

        return <ChatLog inSheet reads={reads} players={players} typing={[]} />;
      });
      const viewport = screen.getByRole("log");
      Object.defineProperties(viewport, {
        clientHeight: { value: 200 },
        scrollHeight: { value: 500 },
      });
      viewport.scrollTop = 300;
      fireEvent.scroll(viewport);
      vi.advanceTimersToNextFrame();
      viewport.scrollTop = 100;
      fireEvent.scroll(viewport);
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
      flush();

      setLog([
        entry,
        { at: entry.at, from: ben, game: 1, id: 2, round: 1, text: "gl" },
      ]);
      flush();

      expect(
        screen.getByRole("radio", { name: "Chat, 1 unread" })
      ).toHaveTextContent("Chat1");
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("keeps round headings over chat in the Chat filter", () => {
    const log = twoRounds();
    log.push({
      at: Date.now(),
      from: ana,
      game: 1,
      id: log.length + 1,
      round: 2,
      text: "gg",
    });
    render(() => (
      <GameLog log={log} playerId="a" players={players} typing={[]} />
    ));

    fireEvent.click(screen.getByRole("radio", { name: "Chat" }));
    flush();

    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent)
    ).toStrictEqual(["Round 1", "Round 2"]);
    expect(screen.queryByRole("button", { name: "Round 1" })).toBeNull();
  });

  it("tints your own events and shows cards and points as chips", () => {
    render(() => (
      <GameLog log={twoRounds()} playerId="b" players={players} typing={[]} />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Round 1" }));
    flush();

    expect(rowTexts("mine")).toStrictEqual([
      "Ben busted · duplicate 9",
      "Ben stayed +30 points",
    ]);
    expect(document.querySelector(".log-card")).toHaveTextContent("9");
    expect(document.querySelector(".log-card")?.getAttribute("style")).toBe(
      "--chip-color: var(--number-9);"
    );
  });

  it("highlights a player's lines when their name is tapped", () => {
    render(() => (
      <GameLog log={twoRounds()} playerId="a" players={players} typing={[]} />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Round 1" }));
    flush();

    const benName = itemAt(screen.getAllByRole("button", { name: "Ben" }), 0);
    fireEvent.click(benName);
    flush();

    expect(benName).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Highlighting")).toHaveTextContent(
      "Highlighting Ben"
    );
    expect(rowTexts("spotlit")).toStrictEqual([
      "Ben busted · duplicate 9",
      "Benouch",
      "Ben stayed +30 points",
    ]);

    const anaName = itemAt(screen.getAllByRole("button", { name: "Ana" }), 0);
    fireEvent.click(anaName);
    flush();

    expect({
      ana: anaName.getAttribute("aria-pressed"),
      ben: benName.getAttribute("aria-pressed"),
      spotlit: rowTexts("spotlit"),
    }).toStrictEqual({
      ana: "true",
      ben: "false",
      spotlit: ["Ana stayed +12 points", "Ana deals."],
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    flush();

    expect({
      highlighting: screen.queryByText("Highlighting"),
      spotlit: rowTexts("spotlit"),
    }).toStrictEqual({ highlighting: null, spotlit: [] });
  });

  it("highlights a player's lines by their full name even when it is long", () => {
    const longName = { ...ben, name: "MW".repeat(10) };

    const log: ChatEntry[] = [
      { ...fields(1, Date.now()), from: longName, text: "ouch" },
    ];

    render(() => (
      <GameLog log={log} playerId="a" players={[ana, longName]} typing={[]} />
    ));
    fireEvent.click(screen.getByRole("radio", { name: "Chat" }));
    flush();

    const author = screen.getByRole("button", { name: longName.name });
    expect(author).toHaveAttribute("title", longName.name);
    fireEvent.click(author);
    flush();

    const highlighting = screen.getByText("Highlighting");
    expect(highlighting).toHaveAttribute("title", longName.name);
    expect({
      highlighting: highlighting.textContent,
      pressed: author.getAttribute("aria-pressed"),
      spotlit: rowTexts("spotlit"),
    }).toStrictEqual({
      highlighting: `Highlighting ${longName.name}`,
      pressed: "true",
      spotlit: [`${longName.name}ouch`],
    });
  });

  it("counts characters near the limit and reports typing until the draft is cleared", () => {
    const chat = chatControls();
    render(() => (
      <GameLog
        log={[]}
        playerId="a"
        players={players}
        typing={["b"]}
        chat={chat}
      />
    ));

    const draft = screen.getByRole("textbox", { name: "Chat message" });

    expect(screen.getByText("Ben is typing…")).toBeVisible();

    fireEvent.input(draft, { target: { value: "hi" } });
    flush();
    fireEvent.input(draft, { target: { value: "" } });
    flush();

    expect(chat.typed).toStrictEqual([true, false]);
    expect(charCount()).not.toBeVisible();

    fireEvent.input(draft, { target: { value: "x".repeat(170) } });
    flush();

    expect(charCount()).toBeVisible();
    expect(charCount()).toHaveTextContent("170/200");
  });

  it("counts and caps chat drafts by whole characters so emoji are not cut short", () => {
    const chat = chatControls(
      (text) =>
        parseClientMessage(JSON.stringify({ text, type: "chat" })) !== null
    );

    render(() => (
      <GameLog
        log={[]}
        playerId="a"
        players={players}
        typing={[]}
        chat={chat}
      />
    ));

    const draft = screen.getByRole("textbox", { name: "Chat message" });
    const family = "👨🏽‍👩🏽‍👧🏽‍👦🏽";

    fireEvent.input(draft, { target: { value: family.repeat(201) } });
    flush();

    expect(draft).toHaveValue(family.repeat(200));
    expect(charCount()).toHaveTextContent("200/200");

    fireEvent.input(draft, { target: { value: `${family.repeat(200)}x` } });
    flush();
    expect(draft).toHaveValue(family.repeat(200));

    screen.getByRole("button", { name: "Send" }).click();
    flush();
    expect(chat.sent).toStrictEqual([family.repeat(200)]);

    const oversized = `Hi x${"\u0301".repeat(CHAT_TEXT_LIMIT.units)}`;
    fireEvent.input(draft, { target: { value: oversized } });
    flush();
    expect(draft).toHaveValue("Hi ");
  });

  it("keeps existing events quiet when a new snapshot repeats them", async () => {
    const [log, setLog] = createSignal(entries(2));

    render(() => (
      <GameLog
        log={log()}
        playerId="p0"
        players={players}
        typing={[]}
        chat={chatControls()}
      />
    ));

    const first = stayed(0);

    const { artifact } = await captureScenario(() => {
      for (let count = 3; count <= 8; count += 1) {
        setLog(entries(count));
        flush();
      }
    }, "game-log-snapshots");

    expectNoDiagnostics(artifact);
    expect(stayed(0)).toBe(first);
    expect(stayed(7)).toHaveTextContent("Player 7 stayed");
  });
});
