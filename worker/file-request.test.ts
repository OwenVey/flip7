import { describe, expect, it } from "vitest";

import { isFileRequest } from "./file-request";

describe(isFileRequest, () => {
  it.each([
    "/.env",
    "/.git/config",
    "/frontend/.env",
    "/config.php",
    "/wp-config.php~",
    "/flip7.example.com.sql.bak",
    "/assets/index-0123abcd.js",
  ])("treats %s as a file", (pathname) => {
    expect(isFileRequest(pathname)).toBeTruthy();
  });

  it.each(["/", "/room/ABCDE", "/_server/data/createRoom-bcba7a9b", "/about"])(
    "leaves the page %s to the app",
    (pathname) => {
      expect(isFileRequest(pathname)).toBeFalsy();
    }
  );
});
