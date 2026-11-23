import { describe, expect, it } from "vitest";

import { parseClientMessage } from "./client-message";

describe(parseClientMessage, () => {
  it("reads a settings change from the host", () => {
    expect(
      parseClientMessage(
        JSON.stringify({ locked: true, targetScore: 300, type: "configure" })
      )
    ).toStrictEqual({ locked: true, targetScore: 300, type: "configure" });
  });

  it("rejects a winning score or bot speed that isn't offered", () => {
    expect(
      parseClientMessage(
        JSON.stringify({ targetScore: 150, type: "configure" })
      )
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ botSpeed: "turbo", type: "configure" })
      )
    ).toBeNull();
  });
});
