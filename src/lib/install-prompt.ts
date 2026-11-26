import { createSignal, onSettled } from "solid-js";

import { isStandalone } from "./standalone";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

/** Set to "true" once the viewer closes the install offer, which then stays hidden. */
export const INSTALL_DISMISSED_KEY = "flip7:install-dismissed";

/**
 * What the home page offers: the browser's own install prompt, the Share →
 * Add to Home Screen steps on iOS (which has no prompt API), or nothing.
 */
export type InstallOffer = "prompt" | "ios" | null;

interface InstallState {
  standalone: boolean;
  dismissed: boolean;
  promptReady: boolean;
  ios: boolean;
}

export const installOffer = (state: InstallState) => {
  let offer: InstallOffer = null;

  if (!(state.standalone || state.dismissed)) {
    if (state.promptReady) {
      offer = "prompt";
    } else if (state.ios) {
      offer = "ios";
    }
  }

  return offer;
};

/** iPhone, iPod, or an iPad, which reports itself as a Mac with a touch screen. */
export const isIOS = (userAgent: string, maxTouchPoints: number) =>
  /iP(?:hone|ad|od)/u.test(userAgent) ||
  (userAgent.includes("Macintosh") && maxTouchPoints > 1);

const readDismissed = () => {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
};

const writeDismissed = () => {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "true");
  } catch {
    // WARNING: storage can be blocked; the offer then hides only until the next visit.
  }
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
let dismissedThisVisit = false;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

/**
 * Catches the browser's install prompt so the home page can offer it later.
 * Call once, as early as the app runs in the browser: Chromium fires
 * `beforeinstallprompt` only once per page load. Returns a function that
 * stops listening.
 */
export const listenForInstallPrompt = () => {
  const controller = new AbortController();
  const { signal } = controller;

  addEventListener(
    "beforeinstallprompt",
    (event) => {
      event.preventDefault();
      deferredPrompt = event;
      notify();
    },
    { signal }
  );

  addEventListener(
    "appinstalled",
    () => {
      deferredPrompt = null;
      installed = true;
      notify();
    },
    { signal }
  );

  return () => {
    controller.abort();
  };
};

const currentOffer = () =>
  installOffer({
    dismissed: dismissedThisVisit || readDismissed(),
    ios: isIOS(navigator.userAgent, navigator.maxTouchPoints),
    promptReady: deferredPrompt !== null,
    standalone: installed || isStandalone(),
  });

const install = async () => {
  const prompt = deferredPrompt;

  if (prompt === null) {
    return;
  }

  deferredPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  installed ||= outcome === "accepted";
  notify();
};

const dismiss = () => {
  dismissedThisVisit = true;
  writeDismissed();
  notify();
};

/** The install offer for this browser, and the actions behind its buttons. */
export const createInstallOffer = () => {
  const [offer, setOffer] = createSignal<InstallOffer>(null);

  const update = () => {
    setOffer(currentOffer());
  };

  // WARNING: install state exists only in the browser, so read it after hydration to match the server markup.
  onSettled(() => {
    update();
    listeners.add(update);

    return () => {
      listeners.delete(update);
    };
  });

  return { dismiss, install, offer };
};
