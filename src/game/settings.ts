import * as v from "valibot";

/** The winning scores the host can pick from. */
export const TARGET_SCORES = [100, 200, 300] as const;

export const BOT_SPEEDS = ["normal", "fast"] as const;

export type TargetScore = (typeof TARGET_SCORES)[number];

export type BotSpeed = (typeof BOT_SPEEDS)[number];

export const RoomSettingsSchema = v.object({
  /** How fast bots make their moves. */
  botSpeed: v.picklist(BOT_SPEEDS),
  /** A locked room blocks new player and spectator admissions. Players can still rejoin. */
  locked: v.boolean(),
  /** The score a sole leader needs at the end of a round to win. */
  targetScore: v.picklist(TARGET_SCORES),
});

/** How the host has set up the room. These are stored in rooms and sent in WebSocket state messages. */
export type RoomSettings = v.InferOutput<typeof RoomSettingsSchema>;

export const DEFAULT_SETTINGS: Readonly<RoomSettings> = {
  botSpeed: "normal",
  locked: false,
  targetScore: 200,
};
