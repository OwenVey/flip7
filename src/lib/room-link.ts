import { CODE_ALPHABET, CODE_LENGTH, normalizeCode } from "../game/protocol";

const ROOM_PATH_PATTERN = new RegExp(
  `^/room/([${CODE_ALPHABET}]{${CODE_LENGTH}})/?$`,
  "iu"
);

const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:\/\//iu;

/** The room code in a pasted room link, like `https://…/room/ABCDE`. */
export const codeFromRoomLink = (text: string) => {
  for (const token of text.trim().split(/\s+/u)) {
    let url: URL;

    try {
      url = new URL(
        URL_SCHEME_PATTERN.test(token) ? token : `https://${token}`
      );
    } catch {
      continue;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      continue;
    }

    const match = ROOM_PATH_PATTERN.exec(url.pathname);
    const code = match?.[1] === undefined ? null : normalizeCode(match[1]);

    if (code !== null) {
      return code;
    }
  }

  return null;
};
