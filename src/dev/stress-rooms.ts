import {
  addBot,
  addPlayer,
  chat,
  configure,
  createGame,
  leave,
  LOG_LIMIT,
  nextRound,
  playForBot,
  startGame,
} from "../game/engine";
import type { GameState } from "../game/engine";
import { MAX_SPECTATORS } from "../game/moves";
import { cleanName, toRoomView } from "../game/protocol";
import type { RoomView } from "../game/protocol";
import type { TargetScore } from "../game/settings";

export const DATASETS = ["demo", "worst", "minimum", "full"] as const;
export const PHASES = ["lobby", "playing", "roundOver", "gameOver"] as const;
export const VIEWERS = ["player", "watcher"] as const;

export type Dataset = (typeof DATASETS)[number];

export type StressPhase = (typeof PHASES)[number];

export type Viewer = (typeof VIEWERS)[number];

interface FixturePlayer {
  name: string;
  bot?: true;
  offline?: true;
}

interface Spec {
  players: FixturePlayer[];
  viewer: number;
  spectators: number;
  targetScore: TargetScore;
  chats: string[];
  typing: number[];
  fillLog?: true;
  winnerLeaves?: true;
}

const LONG_CHAT =
  "ok so my rule is if I've got a 12 and a 11 out I stay no matter what, but Bartholomew keeps hitting on 60+ and somehow never busts?? we need to check that deck honestly, this is the third game in a row lol";

const WORST_CHATS = [
  LONG_CHAT,
  "https://example.com/flip7/house-rules/2026/tournament-bracket?round=semifinal&table=3",
  "gg",
  "😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂",
  "<b>no way</b> &amp; **again**",
  "Rindfleischetikettierungsüberwachungsaufgaben",
  "يا جماعة دوري الآن؟",
  "k",
];

const SPECS: Record<Dataset, Spec> = {
  demo: {
    chats: ["good luck!", "nice one"],
    players: [
      { name: "Ana" },
      { name: "Ben" },
      { name: "Cleo" },
      { name: "Dev" },
    ],
    spectators: 0,
    targetScore: 200,
    typing: [],
    viewer: 0,
  },
  full: {
    chats: WORST_CHATS,
    fillLog: true,
    players: [
      { name: "BARTHOLOMEW MCMILLAN" },
      { name: "Aleksandra Wiśniewska-Kowalczyk" },
      { name: "Jo", offline: true },
      { name: "Đặng Thị Ngọc Hân" },
      { name: "王秀英" },
      { name: "نور الهدى عبد الرحمن" },
      { name: "👩🏽‍💻 Priya" },
      { bot: true, name: "" },
      { name: "Seán O'Brien-Ó Súilleabháin" },
      { name: "J" },
      { name: "Christopher Montgomery III" },
      { name: "Konstantin Oberhauser" },
      { name: "María José de la Cruz" },
      { bot: true, name: "" },
      { name: "Ólafur Darri Ólafsson", offline: true },
      { name: "Maximilian Wołodźko" },
    ],
    spectators: MAX_SPECTATORS,
    targetScore: 300,
    typing: [0, 1, 3, 8],
    viewer: 1,
  },
  minimum: {
    chats: ["k"],
    winnerLeaves: true,
    players: [{ name: "Jo" }, { name: "J" }],
    spectators: 1,
    targetScore: 100,
    typing: [1],
    viewer: 0,
  },
  worst: {
    chats: WORST_CHATS,
    players: [
      { name: "BARTHOLOMEW MCMILLAN" },
      { name: "Aleksandra Wiśniewska-Kowalczyk" },
      { name: "Konstantin Oberhauser", offline: true },
      { name: "Đặng Thị Ngọc Hân" },
      { name: "王秀英" },
      { name: "نور الهدى عبد الرحمن" },
      { name: "👩🏽‍💻 Priya" },
      { bot: true, name: "" },
      { name: "Seán O'Brien-Ó Súilleabháin" },
      { name: "<b>Kuba</b>" },
    ],
    spectators: 7,
    targetScore: 300,
    typing: [0, 1],
    viewer: 1,
  },
};

const seeded = (seed: number) => {
  let value = seed;

  return () => {
    value = (value * 16_807) % 2_147_483_647;

    return (value - 1) / 2_147_483_646;
  };
};

const idOf = (index: number) => `p${index}`;

const addPlayers = (state: GameState, spec: Spec, random: () => number) => {
  for (const [index, { name, bot }] of spec.players.entries()) {
    if (bot === true) {
      addBot(state, idOf(0), idOf(index), random);
    } else {
      addPlayer(state, idOf(index), cleanName(name), (index % 25) + 1);
    }
  }
};

const isDone = (
  state: GameState,
  phase: StressPhase,
  viewerId: string,
  steps: number
) => {
  if (phase === "gameOver") {
    return state.phase === "gameOver";
  }

  if (phase === "roundOver") {
    return state.phase === "roundOver" && state.round >= 3;
  }

  return (
    state.phase === "playing" &&
    state.round >= 3 &&
    steps > 12 &&
    state.turnId === viewerId &&
    state.choice === null
  );
};

const playTo = (
  state: GameState,
  spec: Spec,
  phase: StressPhase,
  viewerId: string,
  random: () => number
) => {
  const people = state.players.filter((player) => !player.bot);

  for (const player of people) {
    player.bot = true;
  }

  const chats = [...spec.chats];
  let steps = 0;

  while (!isDone(state, phase, viewerId, steps) && steps < 5000) {
    steps += 1;

    if (state.phase === "gameOver") {
      break;
    }

    if (state.phase === "roundOver") {
      nextRound(state, idOf(0), random);
    } else if (!playForBot(state, random)) {
      break;
    }

    const message = chats.shift();

    if (message !== undefined && steps % 3 === 0) {
      const from = people[steps % people.length];

      if (from) {
        chat(state, from.id, message);
      }
    } else if (message !== undefined) {
      chats.unshift(message);
    }
  }

  for (const player of people) {
    player.bot = false;
  }

  return chats;
};

export interface StressRoom {
  room: RoomView;
  playerId: string | null;
  typing: string[];
}

export const stressRoom = (
  dataset: Dataset,
  phase: StressPhase,
  viewer: Viewer
) => {
  const spec = SPECS[dataset];
  const random = seeded(7);
  const state = createGame();
  const viewerId = idOf(spec.viewer);

  addPlayers(state, spec, random);
  configure(state, idOf(0), { targetScore: spec.targetScore });

  let unsent = spec.chats;

  if (phase === "lobby") {
    for (const [index, message] of spec.chats.entries()) {
      chat(state, idOf(index % 2), message);
    }

    unsent = [];
  } else {
    startGame(state, idOf(0), random);
    unsent = playTo(state, spec, phase, viewerId, random);
  }

  const [winnerId] = state.winnerIds;

  if (
    spec.winnerLeaves === true &&
    winnerId !== undefined &&
    winnerId !== viewerId
  ) {
    leave(state, winnerId, random);
  }

  for (const message of unsent) {
    chat(state, viewerId, message);
  }

  if (spec.fillLog === true) {
    const talkers = state.players.filter((player) => !player.bot);

    for (let index = 0; state.log.length < LOG_LIMIT; index += 1) {
      const from = talkers[index % talkers.length];
      const message = spec.chats[index % spec.chats.length];

      if (from && message !== undefined) {
        chat(state, from.id, message);
      }
    }
  }

  for (const [index, { offline }] of spec.players.entries()) {
    const player = state.players.find(({ id }) => id === idOf(index));

    if (player && offline === true) {
      player.connected = false;
    }
  }

  const typing: string[] = [];

  for (const index of spec.typing) {
    if (idOf(index) !== viewerId) {
      typing.push(idOf(index));
    }
  }

  return {
    playerId: viewer === "watcher" ? null : viewerId,
    room: toRoomView("WXYZK", state, spec.spectators),
    typing,
  } satisfies StressRoom;
};
