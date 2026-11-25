import type { Card, RoundScore } from "./cards";

export type RoundStatus =
  | "out"
  | "active"
  | "stayed"
  | "frozen"
  | "busted"
  | "flipSeven";

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
