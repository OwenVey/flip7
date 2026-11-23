/** The winning scores the host can pick from. */
export const TARGET_SCORES = [100, 200, 300] as const;

export const BOT_SPEEDS = ["normal", "fast"] as const;

export type TargetScore = (typeof TARGET_SCORES)[number];

export type BotSpeed = (typeof BOT_SPEEDS)[number];

/** How the host has set up the room. These are stored in rooms and sent in WebSocket state messages. */
export interface RoomSettings {
  /** How fast bots make their moves. */
  botSpeed: BotSpeed;
  /** A locked room turns away new players. Anyone already seated can still rejoin. */
  locked: boolean;
  /** The score a sole leader needs at the end of a round to win. */
  targetScore: TargetScore;
}

export const DEFAULT_SETTINGS: Readonly<RoomSettings> = {
  botSpeed: "normal",
  locked: false,
  targetScore: 200,
};

/** A room's settings, with defaults for rooms saved before settings existed. */
export const settingsOf = (state: { settings?: Partial<RoomSettings> }) => {
  const settings: RoomSettings = { ...DEFAULT_SETTINGS, ...state.settings };

  return settings;
};
