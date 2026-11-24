/**
 * New entries in a list whose entries carry increasing sequence numbers, sent
 * as the entries added since the receiver's copy instead of in full.
 */
export interface ListUpdate<T> {
  /**
   * The sequence the receiver's copy must have reached for `entries` to
   * follow on from it. Null when `entries` replace the whole list.
   */
  after: number | null;
  entries: T[];
  /** The list's sequence number when this was sent. */
  seq: number;
}

/** What the sender knows about a list. */
export interface SequencedList<T> {
  /** Oldest first, with consecutive sequence numbers. Older entries may be trimmed from the front. */
  entries: T[];
  /** The newest sequence number handed out, even if that entry has since been cleared. */
  seq: number;
  /** The sequence number when the list was last cleared. Entries at or below it belong to an earlier list. */
  clearedAt: number;
}

/** A receiver's copy of a list: its entries and the sequence it is caught up to. */
export interface ReceivedList<T> {
  entries: T[];
  seq: number;
}

/** How to read a list's entries: each entry's sequence number, and how many entries a receiver keeps. */
export interface ListSpec<T> {
  seqOf: (entry: T) => number;
  limit: number;
}

export const fullList = <T>(list: SequencedList<T>) => {
  const update: ListUpdate<T> = {
    after: null,
    entries: [...list.entries],
    seq: list.seq,
  };

  return update;
};

/**
 * The entries a receiver caught up to `since` is missing. Sends the whole list
 * when `since` is unknown, from before the list was last cleared, ahead of
 * the list, or older than the entries still kept.
 */
export const listUpdateSince = <T>(
  list: SequencedList<T>,
  since: number | undefined,
  spec: Pick<ListSpec<T>, "seqOf">
) => {
  if (since === undefined || since <= list.clearedAt || since > list.seq) {
    return fullList(list);
  }

  const [first] = list.entries;

  if (first !== undefined && spec.seqOf(first) > since + 1) {
    return fullList(list);
  }

  const update: ListUpdate<T> = {
    after: since,
    entries: list.entries.filter((entry) => spec.seqOf(entry) > since),
    seq: list.seq,
  };

  return update;
};

/**
 * Applies an update to the receiver's copy. Returns null when the update
 * doesn't follow on from the copy, or comes from a list behind it, so the
 * receiver needs the whole list.
 * Entries the copy already has are skipped, and only the newest `limit` are
 * kept. The copy is returned unchanged when nothing is new.
 */
export const applyListUpdate = <T>(
  current: ReceivedList<T> | null,
  update: ListUpdate<T>,
  spec: ListSpec<T>
) => {
  if (update.after === null) {
    const replaced: ReceivedList<T> = {
      entries: update.entries.slice(-spec.limit),
      seq: update.seq,
    };

    return replaced;
  }

  if (!current || update.after > current.seq || update.seq < current.seq) {
    return null;
  }

  const fresh = update.entries.filter(
    (entry) => spec.seqOf(entry) > current.seq
  );

  if (fresh.length === 0 && update.seq <= current.seq) {
    return current;
  }

  const appended: ReceivedList<T> = {
    entries:
      fresh.length === 0
        ? current.entries
        : [...current.entries, ...fresh].slice(-spec.limit),
    seq: update.seq,
  };

  return appended;
};
