import { createEffect, createMemo, createSignal } from "solid-js";

import type { MessageReactions, ReactionEmoji } from "../game/chat-reactions";
import type { LogEntry, LogPlayer } from "../game/engine";
import type { RoomView } from "../game/protocol";
import { createChatLogReads } from "./chat-log-reads";
import type { ChatControls } from "./room-connection";

interface RoomChatLogSource {
  log: () => LogEntry[];
  reactions: () => RoomView["reactions"];
  players: () => readonly LogPlayer[];
  playerId: () => string | null;
  chat: ChatControls;
  /** Other players typing a chat message, by player ID. */
  typing: () => readonly string[];
  /** The layout puts Chat & Log in a sheet instead of beside the page. */
  inSheet: () => boolean;
  /** The round whose results the table shows, once Deal playback lets them show. */
  resultsRound: () => number | null;
  /** The room's current round, 0 in the lobby. Its log stays unfolded until the next round starts. */
  round: () => number;
}

interface Tap {
  emoji: ReactionEmoji | null;
  id: number;
}

const withReaction = (
  reactions: MessageReactions | undefined,
  playerId: string,
  emoji: ReactionEmoji | null
) => {
  const others = Object.entries(reactions ?? {}).filter(
    ([id]) => id !== playerId
  );

  const shown: MessageReactions = Object.fromEntries(
    emoji === null ? others : [...others, [playerId, emoji]]
  );

  return shown;
};

const createReactions = (
  source: Pick<RoomChatLogSource, "chat" | "playerId" | "reactions">
) => {
  const [taps, setTaps] = createSignal<ReadonlyMap<number, Tap>>(new Map());
  let lastTap = 0;

  const of = (messageId: number) => {
    const confirmed = source.reactions()[messageId];
    const tap = taps().get(messageId);
    const playerId = source.playerId();

    return tap === undefined || playerId === null
      ? confirmed
      : withReaction(confirmed, playerId, tap.emoji);
  };

  const mine = (messageId: number) => {
    const playerId = source.playerId();

    return playerId === null ? undefined : of(messageId)?.[playerId];
  };

  const toggle = async (messageId: number, emoji: ReactionEmoji) => {
    lastTap += 1;

    const tap = {
      emoji: mine(messageId) === emoji ? null : emoji,
      id: lastTap,
    };

    setTaps((current) => new Map(current).set(messageId, tap));
    await source.chat.react(messageId, tap.emoji);
    setTaps((current) => {
      if (current.get(messageId)?.id !== tap.id) {
        return current;
      }

      const next = new Map(current);
      next.delete(messageId);

      return next;
    });
  };

  return { mine, of, toggle };
};

/**
 * The room's Chat & Log for one viewer: the draft, one read state, and
 * whether its sheet is open. Create it once per Room so the draft and unread
 * position carry over from the lobby to the table and between layouts. The
 * sheet makes way for Scores when a round's results show, and reopens only if
 * the viewer opens it during them.
 */
export const createRoomChatLog = (source: RoomChatLogSource) => {
  const [openedAt, setOpenedAt] = createSignal<number | null>();

  const sheetResultsRound = createMemo(() =>
    source.inSheet() ? source.resultsRound() : null
  );

  const sheetOpen = () => {
    const at = openedAt();
    const round = sheetResultsRound();

    return (
      source.inSheet() && at !== undefined && (round === null || at === round)
    );
  };

  createEffect(
    () => ({ inSheet: source.inSheet(), round: sheetResultsRound() }),
    ({ inSheet, round }, previous) => {
      if ((!inSheet && previous?.inSheet === true) || round !== null) {
        setOpenedAt(undefined);
      }
    }
  );

  const reads = createChatLogReads({
    log: source.log,
    playerId: source.playerId,
    shown: () => !source.inSheet() || sheetOpen(),
  });

  return {
    chat: () => (source.playerId() === null ? undefined : source.chat),
    draft: createSignal(""),
    inSheet: source.inSheet,
    players: source.players,
    reads,
    reactions: createReactions(source),
    round: source.round,
    setSheetOpen: (next: boolean) => {
      setOpenedAt(next && source.inSheet() ? sheetResultsRound() : undefined);
    },
    sheetOpen,
    typing: source.typing,
  };
};

export type RoomChatLog = ReturnType<typeof createRoomChatLog>;
