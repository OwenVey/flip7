import { cleanup, render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import AvatarImage from "./avatar-image";

describe("<AvatarImage />", () => {
  afterEach(cleanup);

  it("swaps in a new image element when the avatar changes", () => {
    const [avatar, setAvatar] = createSignal(17);
    const { container } = render(() => <AvatarImage avatar={avatar()} />);
    const first = container.querySelector("img");

    setAvatar(2);
    flush();

    const second = container.querySelector("img");
    expect(second).toHaveAttribute("src", "/avatars/sprite.svg#a2");
    expect(second).not.toBe(first);
  });
});
