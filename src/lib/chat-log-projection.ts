import { createMemo } from "solid-js";

import { isChat } from "../game/engine";
import type { LogEntry } from "../game/engine";
import { settlesRound } from "../game/game-events";
import { continuesChat, groupLog, shownTimes } from "./game-log-entries";
import type { LogGroup } from "./game-log-entries";

interface RoundsSource {
  log: () => LogEntry[];
  visible: () => LogEntry[];
  newFrom: () => number | undefined;
  round: () => number;
}

const roundRows = (entries: LogEntry[], continuations: Set<number>) => {
  const times = shownTimes(entries);

  return entries.map((entry, index) => ({
    continuation: continuations.has(entry.id),
    entry,
    previous: entries[index - 1],
    showTime: times.has(entry.id),
  }));
};

const projectRound = (
  { entries, heading, id }: LogGroup,
  current: boolean,
  continuations: Set<number>,
  newFrom: RoundsSource["newFrom"]
) => {
  const collapsible = entries.some(
    (entry) => !isChat(entry) && settlesRound(entry.event)
  );

  let expandedRows: ReturnType<typeof roundRows> | undefined;
  let foldedRows: ReturnType<typeof roundRows> | undefined;

  return {
    collapsible,
    first: entries[0],
    heading,
    id,
    last: entries.at(-1),
    view: (chosenOpen?: boolean) => {
      const collapsed = collapsible && !(chosenOpen ?? current);
      const markerId = newFrom();

      const marked =
        markerId === undefined
          ? undefined
          : entries.find((entry) => entry.id === markerId);

      const newAboveHeading =
        collapsed && marked !== undefined && !isChat(marked);

      return {
        collapsed,
        newAboveHeading,
        newBeforeRow: newAboveHeading ? undefined : marked?.id,
        rows: collapsed
          ? (foldedRows ??= roundRows(
              entries.filter((entry) => isChat(entry)),
              continuations
            ))
          : (expandedRows ??= roundRows(entries, continuations)),
      };
    },
  };
};

export const createChatLogRounds = (source: RoundsSource) => {
  const continuations = createMemo(() => {
    const log = source.log();
    const ids = new Set<number>();

    for (const [index, entry] of log.entries()) {
      if (continuesChat(entry, log[index - 1])) {
        ids.add(entry.id);
      }
    }

    return ids;
  });

  const groups = createMemo(() => groupLog(source.visible()));

  return createMemo(() => {
    const visible = groups();
    const chatContinuations = continuations();
    const currentRound = source.round();

    return visible.map((group, index) =>
      projectRound(
        group,
        index === visible.length - 1 &&
          group.entries[0]?.round === currentRound,
        chatContinuations,
        source.newFrom
      )
    );
  });
};

export type ChatLogRound = ReturnType<typeof projectRound>;
