import { describe, expect, it } from "vitest";

import { withServerConnectionId } from "./connection-id";

describe(withServerConnectionId, () => {
  it("replaces the connection ID the client asked for", () => {
    const request = new Request(
      "https://flip7.test/parties/game-room/ABCDE?_pk=someone-else&x=1",
      { headers: { Upgrade: "websocket" } }
    );

    const rewritten = withServerConnectionId(request, "server-id");
    const url = new URL(rewritten.url);

    expect(url.searchParams.getAll("_pk")).toStrictEqual(["server-id"]);
    expect(url.searchParams.get("x")).toBe("1");
    expect(rewritten.headers.get("Upgrade")).toBe("websocket");
  });

  it("adds an ID when the client sent none", () => {
    const request = new Request("https://flip7.test/parties/game-room/ABCDE");

    expect(
      new URL(
        withServerConnectionId(request, "server-id").url
      ).searchParams.get("_pk")
    ).toBe("server-id");
  });
});
