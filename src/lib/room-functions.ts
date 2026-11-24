"use server";

import { env } from "cloudflare:workers";

import { CODE_ALPHABET, CODE_LENGTH, normalizeCode } from "../game/protocol";

const MAX_CREATE_ATTEMPTS = 5;

const UNBIASED_BYTE_LIMIT = 256 - (256 % CODE_ALPHABET.length);

const randomCode = () => {
  let code = "";

  while (code.length < CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH))) {
      if (byte < UNBIASED_BYTE_LIMIT && code.length < CODE_LENGTH) {
        code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      }
    }
  }

  return code;
};

// oxlint-disable-next-line react-doctor/server-auth-actions -- Room creation is public by design.
export const createRoom = async () => {
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const code = randomCode();

    // oxlint-disable-next-line no-await-in-loop -- retry only after a code collision
    if (await env.GAME_ROOM.getByName(code).create(code)) {
      return code;
    }
  }

  throw new Error("Couldn't create a room. Try again.");
};

export const roomExists = async (rawCode: string) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- RPC callers can send non-string arguments.
  const code = typeof rawCode === "string" ? normalizeCode(rawCode) : null;

  return code !== null && (await env.GAME_ROOM.getByName(code).exists());
};
