import type { Card, RoundScore } from "./cards";

export const ROUND_STATUSES = [
  "out",
  "active",
  "stayed",
  "frozen",
  "busted",
  "flipSeven",
] as const;

export type RoundStatus = (typeof ROUND_STATUSES)[number];

export interface Player {
  id: string;
  name: string;
  score: number;
  /** Bots are always connected. */
  connected: boolean;
  /** Set on players the room plays itself. */
  bot: boolean;
  /** The avatar a person picked, or null for a bot. */
  avatar: number | null;
  status: RoundStatus;
  hand: Card[];
  bustCard: Card | null;
  lastRound: RoundScore | null;
}
