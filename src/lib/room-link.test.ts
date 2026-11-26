import { describe, expect, it } from "vitest";

import { codeFromRoomLink } from "./room-link";

describe(codeFromRoomLink, () => {
  it("takes the room code from a pasted room link", () => {
    expect(codeFromRoomLink("https://flip7.example/room/ABCDE")).toBe("ABCDE");
    expect(codeFromRoomLink("flip7.example/room/abcde/")).toBe("ABCDE");
    expect(codeFromRoomLink("https://flip7.example/room/ABCDE?x=1#top")).toBe(
      "ABCDE"
    );
    expect(
      codeFromRoomLink("Join me: https://flip7.example/room/FGHJK \n")
    ).toBe("FGHJK");
  });

  it("rejects text without a valid room code in a room path", () => {
    expect(codeFromRoomLink("ABCDE")).toBeNull();
    expect(codeFromRoomLink("https://flip7.example/")).toBeNull();
    expect(codeFromRoomLink("https://flip7.example/room/ABCDEF")).toBeNull();
    expect(codeFromRoomLink("https://flip7.example/room/ABCD")).toBeNull();
    expect(codeFromRoomLink("https://flip7.example/room/ABCIO")).toBeNull();
  });

  it("only reads room codes from a room URL's pathname", () => {
    expect(
      codeFromRoomLink("https://flip7.example/?next=/room/ABCDE")
    ).toBeNull();
    expect(codeFromRoomLink("https://flip7.example/#/room/ABCDE")).toBeNull();
    expect(
      codeFromRoomLink("https://flip7.example/room/ABCDE/settings")
    ).toBeNull();
    expect(
      codeFromRoomLink(
        "https://flip7.example/?next=/room/ABCDE Join me: https://flip7.example/room/FGHJK"
      )
    ).toBe("FGHJK");
  });
});
