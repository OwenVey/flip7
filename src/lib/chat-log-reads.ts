import { createEffect, createMemo, createSignal } from "solid-js";

import { isChat } from "../game/engine";
import type { LogEntry } from "../game/engine";
import { countChatsAfter } from "./game-log-entries";

export const LOG_FILTERS = ["All", "Chat", "Game"] as const;

type LogFilter = (typeof LOG_FILTERS)[number];

interface ReadSource {
  log: () => LogEntry[];
  playerId: () => string | null;
  shown: () => boolean;
}

interface ScrollPosition {
  atEnd: boolean;
  following: boolean;
}

interface ReadPositions {
  limit: number;
  log: LogEntry[];
  readChatId: number;
  viewedId: number;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Compares fields of events already parsed at the wire.
const sameValue: (a: unknown, b: unknown) => boolean = (a, b) => {
  if (a === b) {
    return true;
  }

  if (
    !(a instanceof Object) ||
    !(b instanceof Object) ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    return false;
  }

  const fields = new Map(Object.entries(b));
  const entries = Object.entries(a);

  return (
    entries.length === fields.size &&
    entries.every(
      ([key, value]) => fields.has(key) && sameValue(value, fields.get(key))
    )
  );
};

const sameContent = (a: LogEntry, b: LogEntry) => {
  if (isChat(a) || isChat(b)) {
    return (
      isChat(a) && isChat(b) && a.text === b.text && a.from.id === b.from.id
    );
  }

  return sameValue(a.event, b.event);
};

const sameEntry = (a: LogEntry, b: LogEntry | undefined) =>
  a === b ||
  (b !== undefined &&
    a.id === b.id &&
    a.at === b.at &&
    a.game === b.game &&
    a.round === b.round &&
    sameContent(a, b));

const survivingReadLimit = (before: LogEntry[], log: LogEntry[]) => {
  const oldTail = before.at(-1);
  const tail = log.at(-1);

  if (!oldTail || before === log || (log[0]?.id ?? 0) > oldTail.id) {
    return Number.POSITIVE_INFINITY;
  }

  if (!tail) {
    return 0;
  }

  const formerTail = log.at(oldTail.id - tail.id - 1);

  if (tail.id >= oldTail.id && sameEntry(oldTail, formerTail)) {
    return Number.POSITIVE_INFINITY;
  }

  const oldEntries = new Map(before.map((entry) => [entry.id, entry]));

  return (
    log.findLast((entry) => sameEntry(entry, oldEntries.get(entry.id)))?.id ?? 0
  );
};

export const createChatLogReads = (source: ReadSource) => {
  const [filter, setFilterValue] = createSignal<LogFilter>("All");

  const [position, setScrollPosition] = createSignal<ScrollPosition>({
    atEnd: true,
    following: true,
  });

  const following = () => position().following;

  const visible = createMemo(() => {
    const log = source.log();
    const current = filter();

    if (current === "All") {
      return log;
    }

    return log.filter((entry) => isChat(entry) === (current === "Chat"));
  });

  const latestId = createMemo(() => visible().at(-1)?.id ?? 0);

  const watching = createMemo(
    () => source.shown() && position().atEnd && following()
  );

  const readingChat = createMemo(() => watching() && filter() !== "Game");

  const [newFrom, setNewFrom] = createSignal<number | undefined>();

  const readPositions = createMemo<ReadPositions>((previous) => {
    const log = source.log();
    const limit = survivingReadLimit(previous?.log ?? log, log);

    const readChatId = Math.min(
      previous?.readChatId ?? log.at(-1)?.id ?? 0,
      limit
    );

    return {
      limit,
      log,
      readChatId: readingChat() ? Math.max(readChatId, latestId()) : readChatId,
      viewedId: watching()
        ? latestId()
        : Math.min(previous?.viewedId ?? 0, limit),
    };
  });

  createEffect(
    () => readPositions().limit,
    (limit) => {
      if (Number.isFinite(limit)) {
        setNewFrom((marker) =>
          marker !== undefined && marker > limit ? undefined : marker
        );
      }
    }
  );

  const unreadChats = createMemo(() =>
    readingChat()
      ? 0
      : countChatsAfter(
          source.log(),
          source.playerId(),
          readPositions().readChatId
        )
  );

  const newEntries = createMemo(() =>
    following()
      ? 0
      : visible().filter((entry) => entry.id > readPositions().viewedId).length
  );

  const firstUnseen = createMemo(() =>
    following()
      ? undefined
      : visible().find((entry) => entry.id > readPositions().viewedId)?.id
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

  return {
    clearNewFrom: () => {
      setNewFrom(undefined);
    },
    filter,
    log: source.log,
    newEntries,
    newFrom,
    playerId: source.playerId,
    setFilter: (next: LogFilter) => {
      setNewFrom(undefined);
      setFilterValue(next);
    },
    setScrollPosition: (next: ScrollPosition) => {
      setScrollPosition(next);
    },
    unreadChats,
    visible,
  };
};
