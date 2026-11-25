import { createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { LogEntry } from "../game/engine";
import { countChatsAfter } from "./game-log-entries";

export const LOG_FILTERS = ["All", "Chat", "Game"] as const;

export type LogFilter = (typeof LOG_FILTERS)[number];

interface ReadSource {
  log: () => LogEntry[];
  playerId: () => string | null;
  /** Chat & Log is on screen: always for the side panel, while open for the sheet. */
  shown: () => boolean;
}

export interface ChatLogReads {
  /** Drops the New marker, as after sending a message. */
  clearNewFrom: () => void;
  filter: () => LogFilter;
  /** Entries behind Jump to latest. */
  newEntries: () => number;
  /** The entry the New marker sits above. */
  newFrom: () => number | undefined;
  setFilter: (next: LogFilter) => void;
  /** Whether the log is scrolled to its end, following new entries. */
  setFollowing: (following: boolean) => void;
  /** Chat from other players that hasn't been read. */
  unreadChats: () => number;
  /** The entries the current filter shows. */
  visible: () => LogEntry[];
}

/**
 * What the reader has seen in Chat & Log, for the side panel or the sheet and
 * its trigger. Entries count as seen only while the log is shown and scrolled
 * to its end, so closing the sheet by any path keeps what was read.
 *
 * It keeps two read positions:
 * - the newest entry seen in the current filter, which places the New marker
 *   and counts the entries behind Jump to latest;
 * - the newest entry seen with chat in view, which counts unread chat on the
 *   sheet trigger, the panel heading and the Chat filter.
 */
export const createChatLogReads = (source: ReadSource) => {
  const [filter, setFilterValue] = createSignal<LogFilter>("All");
  const [following, setFollowing] = createSignal(true);

  const visible = createMemo(() => {
    const log = source.log();
    const current = filter();

    if (current === "All") {
      return log;
    }

    return log.filter(
      (entry) => (entry.from !== undefined) === (current === "Chat")
    );
  });

  const latestId = createMemo(() => visible().at(-1)?.id ?? 0);
  const watching = createMemo(() => source.shown() && following());
  const readingChat = createMemo(() => watching() && filter() !== "Game");

  const [viewedId, setViewedId] = createSignal(0);

  const [readChatId, setReadChatId] = createSignal(
    untrack(() => source.log().at(-1)?.id ?? 0)
  );

  createEffect(
    () => ({ chat: readingChat(), id: latestId(), viewing: watching() }),
    ({ chat, id, viewing }) => {
      if (viewing) {
        setViewedId(id);
      }

      if (chat) {
        setReadChatId((previous) => Math.max(previous, id));
      }
    }
  );

  const unreadChats = createMemo(() =>
    readingChat()
      ? 0
      : countChatsAfter(source.log(), source.playerId(), readChatId())
  );

  const newEntries = createMemo(() =>
    following() ? 0 : visible().filter((entry) => entry.id > viewedId()).length
  );

  const [newFrom, setNewFrom] = createSignal<number | undefined>();

  const firstUnseen = createMemo(() =>
    following()
      ? undefined
      : visible().find((entry) => entry.id > viewedId())?.id
  );

  createEffect(firstUnseen, (id) => {
    if (id !== undefined) {
      setNewFrom(id);
    }
  });

  createEffect(
    () => ({ id: latestId(), isFollowing: following() }),
    ({ id, isFollowing }, previous) => {
      if (isFollowing && previous?.isFollowing === true && id !== previous.id) {
        setNewFrom(undefined);
      }
    }
  );

  const reads: ChatLogReads = {
    clearNewFrom: () => {
      setNewFrom(undefined);
    },
    filter,
    newEntries,
    newFrom,
    setFilter: (next) => {
      setNewFrom(undefined);
      setFilterValue(next);
    },
    setFollowing: (next) => {
      setFollowing(next);
    },
    unreadChats,
    visible,
  };

  return reads;
};
