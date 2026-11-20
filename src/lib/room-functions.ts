"use server";

import { env } from "cloudflare:workers";

import { CODE_ALPHABET, CODE_LENGTH, normalizeCode } from "../game/protocol";

const MAX_CREATE_ATTEMPTS = 5;

const randomCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));

  return Array.from(
    bytes,
    (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]
  ).join("");
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
