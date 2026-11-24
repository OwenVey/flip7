import { describe, expect, it } from "vitest";

import { applyListUpdate, listUpdateSince } from "./sequenced-list";
import type { ReceivedList, SequencedList } from "./sequenced-list";

interface Entry {
  seq: number;
}

const spec = { limit: 3, seqOf: (entry: Entry) => entry.seq };

const entries = (...seqs: number[]) => seqs.map((seq) => ({ seq }));

const list = (seqs: number[], seq: number, clearedAt = 0) => {
  const made: SequencedList<Entry> = {
    clearedAt,
    entries: entries(...seqs),
    seq,
  };

  return made;
};

const afterOf = (since: number | undefined, from: SequencedList<Entry>) =>
  listUpdateSince(from, since, spec).after;

describe(listUpdateSince, () => {
  it("sends the entries after `since`", () => {
    expect(listUpdateSince(list([1, 2, 3], 3), 1, spec)).toStrictEqual({
      after: 1,
      entries: entries(2, 3),
      seq: 3,
    });
  });

  it.each([
    ["unknown", undefined, list([1], 1)],
    ["at the last clear", 5, list([6], 6, 5)],
    ["before the last clear", 4, list([6], 6, 5)],
    ["ahead of the list", 9, list([6], 6)],
    ["older than the entries kept", 2, list([5, 6], 6)],
  ])("sends the whole list when `since` is %s", (_, since, from) => {
    expect(afterOf(since, from)).toBeNull();
  });

  it("carries on after the last clear", () => {
    expect(afterOf(6, list([6], 7, 5))).toBe(6);
  });

  it("doesn't share the list's array", () => {
    const from = list([1], 1);
    const sent = listUpdateSince(from, undefined, spec);
    from.entries.push({ seq: 2 });

    expect(sent.entries).toStrictEqual(entries(1));
  });
});

describe(applyListUpdate, () => {
  const have: ReceivedList<Entry> = { entries: entries(1, 2), seq: 2 };

  it("appends entries that follow on, keeping only the newest", () => {
    expect(
      applyListUpdate(have, { after: 2, entries: entries(3, 4), seq: 4 }, spec)
    ).toStrictEqual({ entries: entries(2, 3, 4), seq: 4 });
  });

  it("skips entries it already has", () => {
    expect(
      applyListUpdate(have, { after: 1, entries: entries(2, 3), seq: 3 }, spec)
    ).toStrictEqual({ entries: entries(1, 2, 3), seq: 3 });
  });

  it("returns the same copy when nothing is new", () => {
    expect(applyListUpdate(have, { after: 2, entries: [], seq: 2 }, spec)).toBe(
      have
    );
  });

  it("replaces the list with a whole one", () => {
    expect(
      applyListUpdate(have, { after: null, entries: entries(7), seq: 7 }, spec)
    ).toStrictEqual({ entries: entries(7), seq: 7 });
  });

  it("can't build on a gap or on nothing", () => {
    expect(
      applyListUpdate(have, { after: 3, entries: entries(4), seq: 4 }, spec)
    ).toBeNull();
    expect(
      applyListUpdate(null, { after: 0, entries: entries(1), seq: 1 }, spec)
    ).toBeNull();
  });

  it("can't build on an update from a list behind its copy", () => {
    expect(
      applyListUpdate(have, { after: 1, entries: [], seq: 1 }, spec)
    ).toBeNull();
  });
});
