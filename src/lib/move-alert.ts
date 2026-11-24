import { createEffect, createMemo, createSignal } from "solid-js";

export const MOVE_ALERT_TITLE = "⚡ Your move!";
export const MOVE_ALERT_BLINK_MS = 1000;

/**
 * How the tab shows a move alert. While the tab is hidden it blinks between
 * "lit" (short title, dot) and "dark" (room title, no dot) to catch the eye in
 * a crowded tab strip. Otherwise it stays "steady".
 */
export type MoveAlertBlink = "steady" | "lit" | "dark";

export const createMoveAlertBlink = (
  alerting: () => boolean,
  tabHidden: () => boolean
) => {
  const [lit, setLit] = createSignal(true, { ownedWrite: true });
  const blinking = createMemo(() => alerting() && tabHidden());

  const startBlinking = () => {
    const timer = setInterval(() => {
      setLit((current) => !current);
    }, MOVE_ALERT_BLINK_MS);

    return () => {
      clearInterval(timer);
    };
  };

  createEffect(blinking, (on) => {
    setLit(true);

    return on ? startBlinking() : undefined;
  });

  return () => {
    let blink: MoveAlertBlink = "steady";

    if (blinking()) {
      blink = lit() ? "lit" : "dark";
    }

    return blink;
  };
};
