import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";

import PlayerAvatar from "./player-avatar";

describe("<PlayerAvatar />", () => {
  afterEach(cleanup);

  it("shows a person's avatar as decoration", () => {
    const { container } = render(() => <PlayerAvatar player={{ avatar: 6 }} />);

    expect(container.querySelector("img.avatar")).toHaveAttribute(
      "src",
      "/avatars/sprite.svg#a6"
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows the bot mark when there's no avatar", () => {
    const { container } = render(() => (
      <PlayerAvatar player={{ avatar: null }} />
    ));

    expect(container.querySelector(".bot-avatar")).not.toBeNull();
    expect(container.querySelector("img.avatar")).toBeNull();
  });
});
