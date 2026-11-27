import {
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  untrack,
} from "solid-js";

import plainSvg from "../assets/favicon.svg?raw";
import siteIcon from "../assets/favicon.svg?url";
import type { RoomView } from "../game/protocol";
import { clearAppBadge, showAppBadge } from "./app-badge";
import type { DealPlaybackView } from "./deal-playback";
import { yourMove } from "./table-prompt";

const MOVE_ALERT_TITLE = "⚡ Your move!";
const MOVE_ALERT_BLINK_MS = 1000;
const SITE_ICON = siteIcon;

const DOT =
  '<circle cx="49" cy="15" r="13" fill="#e5322d" stroke="#fcf5e8" stroke-width="4"/>';

const svgUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

const PLAIN_FRAME = svgUrl(plainSvg);
const DOT_FRAME = svgUrl(plainSvg.replace("</svg>", `${DOT}</svg>`));

type Blink = "off" | "steady" | "lit" | "dark";

const ICONS = {
  dark: PLAIN_FRAME,
  lit: DOT_FRAME,
  off: SITE_ICON,
  steady: DOT_FRAME,
} satisfies Record<Blink, string>;

const setSvgIcon = (href: string) => {
  const icon = document.querySelector<HTMLLinkElement>(
    'link[rel="icon"][type="image/svg+xml"]'
  );

  if (icon && icon.getAttribute("href") !== href) {
    icon.setAttribute("href", href);
  }
};

const showBadge = () => {
  showAppBadge();

  return clearAppBadge;
};

const createTabAlert = (
  alerting: () => boolean,
  title: () => string,
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

  const blink = createMemo(() => {
    let state: Blink = "off";

    if (blinking()) {
      state = lit() ? "lit" : "dark";
    } else if (alerting()) {
      state = "steady";
    }

    return state;
  });

  createEffect(() => ICONS[blink()], setSvgIcon);

  createEffect(blinking, (on) => (on ? showBadge() : undefined));

  onSettled(() => () => {
    setSvgIcon(SITE_ICON);
  });

  return () => (blink() === "lit" ? MOVE_ALERT_TITLE : title());
};

export type MoveAlertView = Pick<
  DealPlaybackView,
  "actionsDisabled" | "dealing" | "room"
>;

interface MoveAlertOutputs {
  /** The turn sound, played once per new Move unless the same Move carries on. */
  sound: () => void;
  /** The turn vibration, for a Move that arrived live while the tab is visible. */
  haptic: () => void;
  /** Draws the eye to the action bar and the viewer's seat. */
  nudge: () => void;
}

interface MoveAlertOptions {
  /**
   * The room as last confirmed, ahead of Deal playback. The alert follows each
   * Move as the room confirms it, so playback catching up or replaying a
   * resync can't change which Moves are new or arrived live.
   */
  room: () => RoomView | null;
  /** What Deal playback shows. A whole `DealPlaybackView` fits. */
  view: () => MoveAlertView;
  playerId: () => string | null;
  /** Changes when the room resyncs, so a Move found on reconnect stays silent. */
  syncId: () => number;
  /** The page title while the tab isn't blinking. */
  title: () => string;
  play: MoveAlertOutputs;
  /** True while the browser tab is hidden. */
  tabHidden: () => boolean;
}

interface MoveSeen {
  key: string | null;
  room: RoomView | null;
  syncId: number;
}

const carriesOn = (previous: MoveSeen, next: MoveSeen) =>
  previous.key !== null &&
  previous.room !== null &&
  next.room !== null &&
  previous.room.round === next.room.round &&
  previous.room.choice === null &&
  (next.room.choice === null || next.room.choice.card.kind === "freeze");

/**
 * The Move alert: everything that tells this viewer the game is waiting on
 * them. It follows Moves as the room confirms them and fires once Deal
 * playback has shown the Move and the viewer can act, exactly when the action
 * bar says "Your move". It plays the turn sound once per Move (a Freeze choice
 * right after your own hit carries the same Move on), vibrates only for a Move
 * that arrived live in a visible tab, and nudges the action bar. On the
 * browser tab, the icon gets a dot, and in a hidden tab the title and dot
 * blink so the tab stands out; an installed app also gets a dot on its icon
 * while hidden. Returns whether the alert is on and the page
 * title to use.
 */
export const createMoveAlert = (options: MoveAlertOptions) => {
  const { tabHidden } = options;

  const moveIn = (room: RoomView | null) =>
    room === null
      ? null
      : yourMove(room, options.playerId(), { dealing: false });

  const confirmedMove = createMemo(() => moveIn(options.room()));
  const shownMove = createMemo(() => moveIn(options.view().room));

  const alerting = createMemo(() => {
    const { actionsDisabled, dealing } = options.view();

    return shownMove() !== null && !dealing && !actionsDisabled;
  });

  let pendingMove: string | null = null;
  let soundPending = false;
  let hapticPending = false;

  createEffect(
    () => ({
      key: confirmedMove(),
      room: options.room(),
      syncId: options.syncId(),
    }),
    (next, previous) => {
      const live =
        previous?.room !== null &&
        previous?.room !== undefined &&
        previous.syncId === next.syncId &&
        !untrack(tabHidden);

      hapticPending &&= live;

      if (next.key === (previous?.key ?? null)) {
        return;
      }

      const sameMove = previous !== undefined && carriesOn(previous, next);
      pendingMove = next.key;
      soundPending = next.key !== null && (soundPending || !sameMove);
      hapticPending = next.key !== null && live;
    }
  );

  createEffect(
    () => ({ key: shownMove(), on: alerting() }),
    ({ key, on }) => {
      if (!on || key === null || key !== pendingMove) {
        return;
      }

      pendingMove = null;

      if (soundPending) {
        options.play.sound();
      }

      if (hapticPending) {
        options.play.haptic();
      }

      soundPending = false;
      hapticPending = false;
      options.play.nudge();
    }
  );

  createEffect(tabHidden, (hidden) => {
    hapticPending &&= !hidden;
  });

  const title = createTabAlert(alerting, options.title, tabHidden);

  return { alerting, title };
};
