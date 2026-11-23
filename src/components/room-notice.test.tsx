import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";

import RoomNotice from "./room-notice";

describe("<RoomNotice />", () => {
  afterEach(() => {
    cleanup();
  });

  it("names the room and links home", () => {
    render(() => (
      <RoomNotice title="Out of the room" code="EQXNM" card="deck">
        You left, or the host removed you.
      </RoomNotice>
    ));

    expect(
      screen.getByRole("heading", { name: "Out of the room" })
    ).toBeTruthy();
    expect(screen.getByText("EQXNM")).toBeTruthy();
    expect(screen.getByText("You left, or the host removed you.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Back to home" }).getAttribute("href")
    ).toBe("/");
  });

  it("leaves out the code when there isn't one", () => {
    render(() => (
      <RoomNotice title="Not a room code" card="empty">
        Room codes are five letters.
      </RoomNotice>
    ));

    expect(document.querySelector(".room-code")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to home" })).toBeTruthy();
  });
});
