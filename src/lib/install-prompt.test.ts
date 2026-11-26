import { describe, expect, it } from "vitest";

import { installOffer, isIOS } from "./install-prompt";

const browser = {
  dismissed: false,
  ios: false,
  promptReady: false,
  standalone: false,
};

describe(installOffer, () => {
  it("offers the browser's prompt once it has one", () => {
    expect(installOffer({ ...browser, promptReady: true })).toBe("prompt");
  });

  it("offers the Share steps on iOS, which has no prompt", () => {
    expect(installOffer({ ...browser, ios: true })).toBe("ios");
  });

  it("offers nothing to a browser that can't install", () => {
    expect(installOffer(browser)).toBeNull();
  });

  it("offers nothing once installed or dismissed", () => {
    const ready = { ...browser, ios: true, promptReady: true };

    expect(installOffer({ ...ready, standalone: true })).toBeNull();
    expect(installOffer({ ...ready, dismissed: true })).toBeNull();
  });
});

describe(isIOS, () => {
  it("recognizes iPhones and iPads, including iPads that report a Mac", () => {
    expect(
      isIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)
    ).toBeTruthy();
    expect(
      isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)
    ).toBeTruthy();
    expect(
      isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)
    ).toBeFalsy();
    expect(isIOS("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5)).toBeFalsy();
  });
});
