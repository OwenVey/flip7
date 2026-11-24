/** The winning scores the host can pick from. */
export const TARGET_SCORES = [100, 200, 300] as const;

export const BOT_SPEEDS = ["normal", "fast"] as const;

export type TargetScore = (typeof TARGET_SCORES)[number];

export type BotSpeed = (typeof BOT_SPEEDS)[number];

/** How the host has set up the room. These are stored in rooms and sent in WebSocket state messages. */
export interface RoomSettings {
  /** How fast bots make their moves. */
  botSpeed: BotSpeed;
  /** A locked room blocks new player and spectator admissions. Players can still rejoin. */
  locked: boolean;
  /** The score a sole leader needs at the end of a round to win. */
  targetScore: TargetScore;
}

export const DEFAULT_SETTINGS: Readonly<RoomSettings> = {
  botSpeed: "normal",
  locked: false,
  targetScore: 200,
};
