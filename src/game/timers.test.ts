import { describe, expect, it } from "vitest";

import { addBot, addPlayer, chat, createGame, startGame, stay } from "./engine";
import { waitingOn as waitingOnPlayer } from "./moves";
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_STALE_MS } from "./protocol";
import {
  ABSENT_GRACE_MS,
  BOT_DELAY_MS,
  FAST_BOT_DELAY_MS,
  heartbeatDeadline,
  HOST_GRACE_MS,
  IDLE_EXPIRY_MS,
  nextAlarmAt,
  runTimers,
  syncTimers,
} from "./timers";
import type { RoomTimers } from "./timers";

const random = () => 0.5;
const START = 1_000_000;

const room = (names: string[], playing = false) => {
  const game = createGame();

  for (const name of names) {
    addPlayer(game, name, name, 1);
  }

  if (playing) {
    startGame(game, names[0] ?? "", random);
  }

  const timers: RoomTimers = {
    game,
    hostLeftAt: null,
    lastActiveAt: START,
    stall: null,
  };

  return timers;
};

const goOffline = (timers: RoomTimers, id: string) => {
  const player = timers.game.players.find((candidate) => candidate.id === id);

  if (player) {
    player.connected = false;
  }
};

const humanAgainstBotWaitingOnBot = () => {
  const timers = room(["a"]);
  addBot(timers.game, "a", "bot", random);
  syncTimers(timers, START);
  startGame(timers.game, "a", random);

  if (waitingOnPlayer(timers.game)?.playerId === "a") {
    stay(timers.game, "a", random);
  }

  return timers;
};

describe("room timers", () => {
  it("keeps the silent seat's alarm deadline during repeated chat and heartbeats from another seat", () => {
    const timers = room(["active", "silent"]);
    const silentDeadline = heartbeatDeadline(START, null);

    for (const elapsed of [HEARTBEAT_INTERVAL_MS, 2 * HEARTBEAT_INTERVAL_MS]) {
      const now = START + elapsed;
      chat(timers.game, "active", "Still here");
      timers.lastActiveAt = now;
      syncTimers(timers, now);
      const activeDeadline = heartbeatDeadline(START, new Date(now));
      expect(nextAlarmAt(timers, [activeDeadline, silentDeadline])).toBe(
        START + HEARTBEAT_STALE_MS
      );
      expect(activeDeadline).toBe(now + HEARTBEAT_STALE_MS);
    }
  });

  it("never schedules an alarm in the past for a room left open", () => {
    const timers = room(["a", "b"]);
    const later = START + IDLE_EXPIRY_MS + 1;
    const result = runTimers(timers, later, random, true);
    expect(result).toStrictEqual({ changed: false, expired: false });
    syncTimers(timers, later);
    expect(nextAlarmAt(timers)).toBeGreaterThan(later);
  });

  it("expires an idle room once its sockets are gone", () => {
    const timers = room(["a", "b"]);
    const later = START + IDLE_EXPIRY_MS;
    expect(runTimers(timers, later, random, false).expired).toBeTruthy();
    expect(runTimers(timers, later - 1, random, false).expired).toBeFalsy();
  });

  it("hands the host to someone online after the grace period", () => {
    const timers = room(["a", "b"]);
    goOffline(timers, "a");
    syncTimers(timers, START);
    expect(nextAlarmAt(timers)).toBe(START + HOST_GRACE_MS);

    const result = runTimers(timers, START + HOST_GRACE_MS, random, true);
    expect(result.changed).toBeTruthy();
    expect(timers.game.hostId).toBe("b");
    syncTimers(timers, START + HOST_GRACE_MS);
    expect(timers.hostLeftAt).toBeNull();
  });

  it("starts no clocks when nobody is online", () => {
    const timers = room(["a", "b"], true);
    goOffline(timers, "a");
    goOffline(timers, "b");
    syncTimers(timers, START);
    expect(timers.hostLeftAt).toBeNull();
    expect(timers.stall).toBeNull();
    expect(nextAlarmAt(timers)).toBe(START + IDLE_EXPIRY_MS);
  });

  it("plays for an offline player the game is waiting on", () => {
    const timers = room(["a", "b"], true);
    const waitingOn = timers.game.turnId ?? "";
    goOffline(timers, waitingOn);
    syncTimers(timers, START);
    expect(timers.stall).toStrictEqual({ playerId: waitingOn, since: START });

    const due = START + ABSENT_GRACE_MS;
    runTimers(timers, due - 1, random, true);
    expect(timers.game.turnId).toBe(waitingOn);
    expect(runTimers(timers, due, random, true).changed).toBeTruthy();
    expect(timers.game.turnId).not.toBe(waitingOn);
    expect(timers.stall).toBeNull();
  });

  it("drops the clock when the player comes back", () => {
    const timers = room(["a", "b"], true);
    const waitingOn = timers.game.turnId ?? "";
    goOffline(timers, waitingOn);
    syncTimers(timers, START);

    const player = timers.game.players.find(
      (candidate) => candidate.id === waitingOn
    );

    if (player) {
      player.connected = true;
    }

    syncTimers(timers, START + 1);
    expect(timers.stall).toBeNull();
  });

  it("waits a fixed time before a bot's move", () => {
    const timers = humanAgainstBotWaitingOnBot();
    expect(waitingOnPlayer(timers.game)?.playerId).toBe("bot");

    syncTimers(timers, START);
    const due = START + BOT_DELAY_MS;
    expect(timers.botTurn).toStrictEqual({ at: due, playerId: "bot" });
    expect(nextAlarmAt(timers)).toBe(due);
  });

  it("waits less before a bot's move once the host speeds bots up", () => {
    const timers = humanAgainstBotWaitingOnBot();
    timers.game.settings = {
      botSpeed: "fast",
      locked: false,
      targetScore: 200,
    };

    syncTimers(timers, START);
    expect(timers.botTurn).toStrictEqual({
      at: START + FAST_BOT_DELAY_MS,
      playerId: "bot",
    });
  });

  it("makes the bot's move once its wait is up", () => {
    const timers = humanAgainstBotWaitingOnBot();
    syncTimers(timers, START);
    const due = timers.botTurn?.at ?? 0;

    expect(runTimers(timers, due - 1, random, true).changed).toBeFalsy();
    expect(runTimers(timers, due, random, true).changed).toBeTruthy();
    expect(timers.botTurn).toBeNull();
  });

  it("pauses bots while no human is online", () => {
    const timers = humanAgainstBotWaitingOnBot();
    goOffline(timers, "a");
    syncTimers(timers, START);
    expect(timers.botTurn).toBeNull();
    expect(timers.stall).toBeNull();
    expect(nextAlarmAt(timers)).toBe(START + IDLE_EXPIRY_MS);
  });

  it("never hands the host to a bot", () => {
    const timers = room(["a"]);
    addBot(timers.game, "a", "bot", random);
    goOffline(timers, "a");
    syncTimers(timers, START);
    expect(timers.hostLeftAt).toBeNull();
    expect(timers.game.hostId).toBe("a");
  });
});
