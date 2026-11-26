import { describe, expect, it } from "vitest";

import { parseClientMessage } from "./client-message";
import { CHAT_TEXT_LIMIT, NAME_TEXT_LIMIT } from "./text";

const singleGrapheme = (units: number) => `a${"\u0301".repeat(units - 1)}`;

describe(parseClientMessage, () => {
  it("validates the fixed reaction palette and the message ID", () => {
    const reaction = { emoji: "❤️", messageId: 15, type: "react" };
    expect(parseClientMessage(JSON.stringify(reaction))).toStrictEqual(
      reaction
    );
    expect(
      parseClientMessage(JSON.stringify({ ...reaction, emoji: null }))
    ).toStrictEqual({
      ...reaction,
      emoji: null,
    });
    expect(
      parseClientMessage(JSON.stringify({ ...reaction, emoji: "💯" }))
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ ...reaction, messageId: 0 }))
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ ...reaction, messageId: 1.5 }))
    ).toBeNull();
  });

  it("bounds join and chat payloads even when they consist of one grapheme", () => {
    const join = {
      name: singleGrapheme(NAME_TEXT_LIMIT.units),
      token: null,
      type: "join",
    };

    const chat = { text: singleGrapheme(CHAT_TEXT_LIMIT.units), type: "chat" };

    expect(parseClientMessage(JSON.stringify(join))).toStrictEqual(join);
    expect(parseClientMessage(JSON.stringify(chat))).toStrictEqual(chat);
    expect(
      parseClientMessage(
        JSON.stringify({ ...join, name: `${join.name}\u0301` })
      )
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ ...chat, text: `${chat.text}\u0301` })
      )
    ).toBeNull();
  });

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
