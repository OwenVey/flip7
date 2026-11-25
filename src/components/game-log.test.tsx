import { expectNoDiagnostics } from "@solidjs/diagnostics";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LogEntry } from "../game/engine";
import { captureScenario } from "../test/diagnostics";
import GameLog from "./game-log";

const entries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    at: 0,
    cue: "bank",
    game: 1,
    id: index + 1,
    round: 1,
    text: `Player ${index} stayed and banked ${index + 1} points.`,
  })) satisfies LogEntry[];

const ana = { avatar: 1, id: "a", name: "Ana" };
const ben = { avatar: 2, id: "b", name: "Ben" };
const players = [ana, ben];

const twoRounds = () => {
  const cues: Pick<LogEntry, "cue" | "from" | "round" | "text">[] = [
    { cue: "bank", round: 1, text: "Ana stayed and banked 12 points." },
    { cue: "bust", round: 1, text: "Ben was dealt a duplicate 9 and busted." },
    { from: ben, round: 1, text: "ouch" },
    { round: 2, text: "Round 2 begins. Ana deals." },
    { cue: "bank", round: 2, text: "Ben stayed and banked 30 points." },
  ];

  const log: LogEntry[] = cues.map((entry, index) => ({
    at: Date.now(),
    game: 1,
    id: index + 1,
    ...entry,
  }));

  return log;
};

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
    render(() => <GameLog phase="playing" log={entries(1)} playerId={null} />);

    expect(screen.queryByRole("textbox", { name: "Chat message" })).toBeNull();
    expect(screen.getByText("Join as a player to chat.")).toBeInTheDocument();
  });

  it("groups nearby chat by player and restarts after an event or a pause", () => {
    const own = { avatar: 1, id: "p0", name: "Owen" };
    const guest = { avatar: 2, id: "p1", name: "Ben" };
    const now = Date.now();

    const log = [
      { at: now, from: own, text: "Hello!" },
      { at: now + 1000, from: own, text: "Good luck!" },
      { at: now + 2000, from: guest, text: "You too!" },
      { at: now + 3000, text: "Room unlocked." },
      { at: now + 4000, from: guest, text: "Ready?" },
      { at: now + 64_000, from: guest, text: "Still here." },
    ].map((entry, index) => ({ ...entry, game: 1, id: index + 1, round: 1 }));

    render(() => <GameLog phase="playing" log={log} playerId={own.id} />);

    const bubbles = screen
      .getAllByRole("listitem")
      .filter((row) => row.dataset.kind === "chat");

    expect(
      bubbles.map((row) => ({
        continuation: Object.hasOwn(row.dataset, "continuation"),
        own: Object.hasOwn(row.dataset, "own"),
        author: row.querySelector("strong")?.textContent ?? null,
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
        phase="playing"
        log={[]}
        playerId="p0"
        onChat={(text) => {
          if (!connected()) {
            return false;
          }

          sent.push(text);

          return true;
        }}
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

  it("folds a finished round into a summary that keeps its chat", () => {
    render(() => (
      <GameLog
        phase="playing"
        log={twoRounds()}
        playerId="a"
        players={players}
      />
    ));

    const toggle = screen.getByRole("button", { name: "Round 1" });

    const folding = () => ({
      expanded: toggle.getAttribute("aria-expanded"),
      rows: rowTexts(),
      summary: document.querySelector(".log-round-summary")?.textContent,
    });

    expect(folding()).toStrictEqual({
      expanded: "false",
      rows: ["Benouch", "Ana deals.", "Ben stayed +30 points"],
      summary: "Ana +12 · 1 bust",
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
        "Ana deals.",
        "Ben stayed +30 points",
      ],
      summary: undefined,
    });

    const panel = toggle
      .closest(".log-group")
      ?.querySelector('[data-slot="collapsible-panel"]');

    expect(panel).toHaveTextContent("Ana stayed");
    expect(toggle).toHaveAttribute("aria-controls", panel?.id);
  });

  it("makes the last round foldable as soon as it finishes", () => {
    const [phase, setPhase] = createSignal<
      "playing" | "roundOver" | "gameOver"
    >("playing");

    render(() => <GameLog phase={phase()} log={twoRounds()} playerId="a" />);

    expect(screen.queryByRole("button", { name: "Round 2" })).toBeNull();
    setPhase("roundOver");
    flush();

    const toggle = screen.getByRole("button", { name: "Round 2" });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Ben +30")).toBeVisible();
    setPhase("gameOver");
    flush();
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
      { at: 2000, game: 1, id: 2, round: 1, text: "Room unlocked." },
      { at: 3000, game: 1, id: 3, from: ben, round: 1, text: "Second" },
    ];

    render(() => <GameLog phase="roundOver" log={log} playerId="a" />);

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
        game: 1,
        round: 1,
        id: 1,
        text: "Round 1 begins. Ben deals.",
      };

      const [log, setLog] = createSignal<LogEntry[]>([entry]);

      render(() => <GameLog phase="playing" log={log()} playerId="a" />);
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
        { ...entry, id: 2, text: "Round 1 is over." },
        { ...entry, id: 3, round: 2, text: "Round 2 begins. Ana deals." },
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

  it("keeps round headings over chat in the Chat filter", () => {
    const log = twoRounds();
    log.push({
      at: Date.now(),
      from: ana,
      game: 1,
      id: 6,
      round: 2,
      text: "gg",
    });
    render(() => (
      <GameLog phase="playing" log={log} playerId="a" players={players} />
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
      <GameLog
        phase="playing"
        log={twoRounds()}
        playerId="b"
        players={players}
      />
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
      <GameLog
        phase="playing"
        log={twoRounds()}
        playerId="a"
        players={players}
      />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Round 1" }));
    flush();

    const [benName] = screen.getAllByRole("button", { name: "Ben" });
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

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    flush();

    expect(screen.queryByText("Highlighting")).toBeNull();
  });

  it("counts characters near the limit and reports typing", () => {
    let typed = 0;
    render(() => (
      <GameLog
        phase="playing"
        log={[]}
        playerId="a"
        players={players}
        typing={["b"]}
        onChat={() => true}
        onTyping={() => {
          typed += 1;
        }}
      />
    ));

    const draft = screen.getByRole("textbox", { name: "Chat message" });

    expect(screen.getByText("Ben is typing…")).toBeVisible();

    fireEvent.input(draft, { target: { value: "hi" } });
    flush();

    expect(typed).toBe(1);
    expect(charCount()).not.toBeVisible();

    fireEvent.input(draft, { target: { value: "x".repeat(170) } });
    flush();

    expect(charCount()).toBeVisible();
    expect(charCount()).toHaveTextContent("170/200");
  });

  it("keeps existing events quiet when a new snapshot repeats them", async () => {
    const [log, setLog] = createSignal(entries(2));

    render(() => (
      <GameLog phase="playing" log={log()} playerId="p0" onChat={() => true} />
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
