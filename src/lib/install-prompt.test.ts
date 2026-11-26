import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const firePrompt = (outcome: "accepted" | "dismissed") => {
  const log: string[] = [];

  const event = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    {
      prompt: async () => {
        log.push("prompt");
        await Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome }),
    }
  );

  dispatchEvent(event);

  return { event, log };
};

describe("createInstallOffer", () => {
  let stopListening: (() => void) | undefined;

  const load = async () => {
    vi.resetModules();
    const { createRoot, flush } = await import("solid-js");
    const module = await import("./install-prompt");
    stopListening = module.listenForInstallPrompt();

    return createRoot((dispose) => {
      const offer = module.createInstallOffer();
      flush();

      return { ...offer, dispose, flush };
    });
  };

  beforeEach(() => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom lacks matchMedia, which the standalone check reads.
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });

  afterEach(() => {
    stopListening?.();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("offers the browser's prompt and hides once the app is installed", async () => {
    const offer = await load();
    expect(offer.offer()).toBeNull();

    const { event, log } = firePrompt("accepted");
    offer.flush();

    expect(event.defaultPrevented).toBeTruthy();
    expect(offer.offer()).toBe("prompt");

    await offer.install();
    offer.flush();

    expect(log).toStrictEqual(["prompt"]);
    expect(offer.offer()).toBeNull();
    offer.dispose();
  });

  it("offers nothing when already running as an installed app", async () => {
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom can't launch from a home screen.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    // oxlint-disable-next-line landmines-testing/no-test-doubles -- jsdom reports a desktop user agent; the iOS steps need an iPhone.
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"
    );
    const offer = await load();

    firePrompt("dismissed");
    offer.flush();

    expect(offer.offer()).toBeNull();
    offer.dispose();
  });
});
