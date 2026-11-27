import { createRoot, createSignal, flush, untrack } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import plainSvg from "../assets/favicon.svg?raw";
import siteIcon from "../assets/favicon.svg?url";
import type { RoomView } from "../game/protocol";
import { room } from "../test/room-view";
import { createMoveAlert } from "./move-alert";
import type { MoveAlertView } from "./move-alert";

const ROOM_TITLE = "Your move · Room ABCDE · Flip 7";
const ALERT_TITLE = "⚡ Your move!";

const settled = (shown: RoomView | null) =>
  ({
    actionsDisabled: false,
    dealing: false,
    room: shown,
  }) satisfies MoveAlertView;

const ownTurn = room({ turnId: "a" });

const createAlert = (
  initial: MoveAlertView,
  options: { playerId?: string | null } = {}
) =>
  createRoot((dispose) => {
    const playerId = options.playerId === undefined ? "a" : options.playerId;
    const [view, setView] = createSignal(initial);
    const [confirmed, setConfirmed] = createSignal(initial.room);
    const [syncId, setSyncId] = createSignal(1);
    const [hidden, setHidden] = createSignal(false);
    const played: string[] = [];

    const alert = createMoveAlert({
      play: {
        haptic: () => {
          played.push("haptic");
        },
        nudge: () => {
          played.push("nudge");
        },
        sound: () => {
          played.push("sound");
        },
      },
      playerId: () => playerId,
      room: confirmed,
      syncId,
      tabHidden: hidden,
      title: () => ROOM_TITLE,
      view,
    });

    flush();

    return {
      alerting: alert.alerting,
      dispose: () => {
        dispose();
        flush();
      },
      played,
      setHidden: (next: boolean) => {
        setHidden(next);
        flush();
      },
      confirm: (next: RoomView, resync = false) => {
        if (resync) {
          setSyncId((current) => current + 1);
        }

        setConfirmed(next);
        flush();
      },
      replay: (next: MoveAlertView) => {
        setView(next);
        flush();
      },
      show: (next: MoveAlertView) => {
        if (next.room !== untrack(confirmed)) {
          setConfirmed(next.room);
          flush();
        }

        setView(next);
        flush();
      },
      title: alert.title,
    };
  });

const setup = (initiallyAlerting: boolean) => {
  const alert = createAlert({
    ...settled(ownTurn),
    actionsDisabled: !initiallyAlerting,
  });

  return {
    ...alert,
    setAlerting: (next: boolean) => {
      alert.show({ ...settled(ownTurn), actionsDisabled: !next });
    },
  };
};

const tick = () => {
  vi.advanceTimersByTime(1000);
  flush();
};

const iconHref = () =>
  document.head
    .querySelector('link[type="image/svg+xml"]')
    ?.getAttribute("href") ?? "";

const icon = () => {
  const href = iconHref();

  if (!href.startsWith("data:")) {
    return href;
  }

  return decodeURIComponent(href).includes("<circle") ? "dot" : "plain";
};

describe(createMoveAlert, () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = `
      <link rel="icon" href="/favicon.ico" sizes="32x32" />
      <link rel="icon" type="image/svg+xml" href="${siteIcon}" />
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves the tab alone when no move is owed", () => {
    const alert = setup(false);

    alert.setHidden(true);
    tick();

    expect(alert.title()).toBe(ROOM_TITLE);
    expect(icon()).toBe(siteIcon);
    alert.dispose();
  });

  it("shows a steady dot while the tab is visible", () => {
    const alert = setup(true);

    tick();

    expect(alert.title()).toBe(ROOM_TITLE);
    expect(icon()).toBe("dot");
    expect(
      document.head.querySelector('link[sizes="32x32"]')?.getAttribute("href")
    ).toBe("/favicon.ico");
    alert.dispose();
  });

  it("draws the dot on top of the site icon", () => {
    const alert = setup(true);

    expect(decodeURIComponent(iconHref())).toContain(
      plainSvg.trimEnd().replace("</svg>", "<circle")
    );
    alert.dispose();
  });

  it("blinks the title and dot together while the tab is hidden", () => {
    const alert = setup(true);

    alert.setHidden(true);
    expect([alert.title(), icon()]).toStrictEqual([ALERT_TITLE, "dot"]);

    tick();
    expect([alert.title(), icon()]).toStrictEqual([ROOM_TITLE, "plain"]);

    tick();
    expect([alert.title(), icon()]).toStrictEqual([ALERT_TITLE, "dot"]);
    alert.dispose();
  });

  it("stops blinking when the player comes back to the tab", () => {
    const alert = setup(true);

    alert.setHidden(true);
    tick();
    alert.setHidden(false);

    expect([alert.title(), icon()]).toStrictEqual([ROOM_TITLE, "dot"]);
    alert.dispose();
  });

  it("puts the site icon back when the alert ends and starts lit next time", () => {
    const alert = setup(true);

    alert.setHidden(true);
    tick();
    alert.setAlerting(false);
    expect([alert.title(), icon()]).toStrictEqual([ROOM_TITLE, siteIcon]);

    alert.setAlerting(true);
    expect([alert.title(), icon()]).toStrictEqual([ALERT_TITLE, "dot"]);
    alert.dispose();
  });

  it("stops the timer and puts the site icon back when disposed", () => {
    const alert = setup(true);

    alert.setHidden(true);
    alert.dispose();

    expect(vi.getTimerCount()).toBe(0);
    expect(icon()).toBe(siteIcon);
  });

  it("badges the installed app's icon only while the move waits in a hidden app", async () => {
    const badge: string[] = [];

    const record = (entry: string) => async () => {
      badge.push(entry);
      await Promise.resolve();
    };

    Object.assign(navigator, {
      clearAppBadge: record("clear"),
      setAppBadge: record("set"),
    });
    const alert = setup(true);

    alert.setHidden(true);
    alert.setHidden(false);
    alert.setHidden(true);
    alert.setAlerting(false);
    alert.dispose();
    await Promise.resolve();

    expect(badge).toStrictEqual(["set", "clear", "set", "clear"]);
    Reflect.deleteProperty(navigator, "setAppBadge");
    Reflect.deleteProperty(navigator, "clearAppBadge");
  });

  it("does nothing to a page without an SVG icon", () => {
    document.head.innerHTML = "";

    expect(() => {
      setup(true).dispose();
    }).not.toThrow();
  });
});

describe("createMoveAlert rules", () => {
  const freezeChoice = room({
    choice: {
      card: { id: 20, kind: "freeze" },
      chooserId: "a",
      options: ["a", "b"],
    },
    drawSeq: 1,
    turnId: "a",
  });

  it("never alerts a Spectator or a host who could move for an offline player", () => {
    const spectator = createAlert(settled(ownTurn), { playerId: null });

    const offlineBen = room({
      players: ownTurn.players.map((player) =>
        player.id === "b" ? { ...player, connected: false } : player
      ),
      turnId: "b",
    });

    const host = createAlert(settled(offlineBen));

    expect({
      host: [host.alerting(), host.played],
      spectator: [spectator.alerting(), spectator.played],
    }).toStrictEqual({ host: [false, []], spectator: [false, []] });
    spectator.dispose();
    host.dispose();
  });

  it("waits for Deal playback to finish and for the viewer to be able to act", () => {
    const alert = createAlert(settled(room({ turnId: "b" })));

    alert.show({ ...settled(ownTurn), dealing: true });
    expect(alert.played).toStrictEqual([]);

    alert.show({ ...settled(ownTurn), actionsDisabled: true });
    expect(alert.played).toStrictEqual([]);

    alert.show(settled(ownTurn));
    expect(alert.played).toStrictEqual(["sound", "haptic", "nudge"]);
    alert.dispose();
  });

  it("stays silent on the first room it sees and after a resync", () => {
    const alert = createAlert(settled(ownTurn));
    expect(alert.played).toStrictEqual(["sound", "nudge"]);

    alert.show(settled(room({ turnId: "b" })));
    alert.confirm(ownTurn, true);
    alert.show(settled(ownTurn));
    expect(alert.played).toStrictEqual(["sound", "nudge", "sound", "nudge"]);
    alert.dispose();
  });

  it("vibrates only while the tab stays visible", () => {
    const alert = createAlert(settled(room({ turnId: "b" })));

    alert.show({ ...settled(ownTurn), dealing: true });
    alert.setHidden(true);
    alert.setHidden(false);
    alert.show(settled(ownTurn));
    expect(alert.played).toStrictEqual(["sound", "nudge"]);
    alert.dispose();
  });

  it("carries your Move on into a Freeze choice from your own hit without a second sound", () => {
    const alert = createAlert(settled(room({ turnId: "b" })));

    alert.show(settled(ownTurn));
    alert.show({ ...settled(ownTurn), actionsDisabled: true });
    alert.show({ ...settled(freezeChoice), dealing: true });
    alert.show(settled(freezeChoice));
    expect(alert.played).toStrictEqual([
      "sound",
      "haptic",
      "nudge",
      "haptic",
      "nudge",
    ]);
    alert.dispose();
  });

  it("sounds again when the same player's turn comes back round", () => {
    const alert = createAlert(settled(room({ turnId: "b" })));

    alert.show(settled(ownTurn));
    alert.show(settled(room({ drawSeq: 1, turnId: "b" })));
    alert.show(settled(room({ drawSeq: 2, turnId: "a" })));
    expect(alert.played).toStrictEqual([
      "sound",
      "haptic",
      "nudge",
      "sound",
      "haptic",
      "nudge",
    ]);
    alert.dispose();
  });

  it("stays still for a Move found on reconnect even when playback animates it", () => {
    const alert = createAlert(settled(ownTurn), { playerId: "b" });
    const bensTurn = room({ drawSeq: 1, turnId: "b" });

    alert.confirm(bensTurn, true);
    alert.replay({ ...settled(room({ turnId: "a" })), dealing: true });
    alert.replay({ ...settled(bensTurn), dealing: true });
    alert.replay(settled(bensTurn));
    expect(alert.played).toStrictEqual(["sound", "nudge"]);
    alert.dispose();
  });

  it("sounds for a new Move when playback catches up past the turns between", () => {
    const alert = createAlert(settled(room({ turnId: "b" })));

    alert.show(settled(ownTurn));
    const adasTurnAgain = room({ drawSeq: 2, turnId: "a" });
    alert.confirm(room({ drawSeq: 1, turnId: "b" }));
    alert.replay({ ...settled(ownTurn), dealing: true });
    alert.confirm(adasTurnAgain);
    alert.replay(settled(adasTurnAgain));
    expect(alert.played).toStrictEqual([
      "sound",
      "haptic",
      "nudge",
      "sound",
      "haptic",
      "nudge",
    ]);
    alert.dispose();
  });
});
