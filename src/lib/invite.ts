import { writeClipboard } from "@solid-primitives/clipboard";
import { createTimer } from "@solid-primitives/timer";
import { createSignal, onSettled } from "solid-js";

const COPIED_RESET_MS = 2000;

const canUseShareSheet = () =>
  "share" in navigator && globalThis.matchMedia?.("(pointer: coarse)").matches;

/** Copies text and reports `copied` for a moment afterwards. */
export const createCopy = () => {
  const [copied, setCopied] = createSignal(false);

  createTimer(
    () => {
      setCopied(false);
    },
    () => (copied() ? COPIED_RESET_MS : false),
    setTimeout
  );

  const copy = async (text: string) => {
    await writeClipboard(text);
    setCopied(true);
  };

  return { copied, copy };
};

/** Shares the room link through the phone's share sheet, or copies it where there is none. */
export const createInvite = () => {
  const { copied, copy } = createCopy();
  const [shares, setShares] = createSignal(false);

  onSettled(() => {
    setShares(canUseShareSheet());
  });

  const invite = async () => {
    if (shares()) {
      try {
        await navigator.share({
          title: "Join my Flip 7 table",
          url: location.href,
        });

        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    await copy(location.href);
  };

  return { copied, invite, shares };
};
