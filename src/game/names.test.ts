import { describe, expect, it } from "vitest";

import { sameName } from "./names";

describe(sameName, () => {
  it("treats a name with a hidden joiner as the name without it", () => {
    expect(sameName("An‍a", "ana")).toBeTruthy();
    expect(sameName("Ana", "Ben")).toBeFalsy();
  });
});
