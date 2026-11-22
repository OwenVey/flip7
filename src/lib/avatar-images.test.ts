import { describe, expect, it } from "vitest";

import { AVATARS } from "../game/avatars";
import { avatarImage } from "./avatar-images";

describe(avatarImage, () => {
  it("has a distinct image for every avatar", () => {
    const images = AVATARS.map(avatarImage);

    expect(images.every((image) => image !== "")).toBeTruthy();
    expect(new Set(images).size).toBe(AVATARS.length);
  });
});
