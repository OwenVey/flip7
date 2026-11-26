import {
  createEffect,
  createMemo,
  createSignal,
  flush,
  onSettled,
} from "solid-js";

import type { RoomView } from "../game/protocol";
import { createDealMotion } from "./deal-motion";
import { createDealPlayback, initialDealPlayback } from "./deal-playback";
import type { DealMotion } from "./deal-playback";
import { MOTION_PREFERENCE_QUERY } from "./motion";
import { createMoveAlert } from "./move-alert";
import type { RoomConnection } from "./room-connection";
import type { RoomCue } from "./room-cues";
import type { RoomHapticCue } from "./room-haptics";
import { createTableOpening, nudge, revealOwnSeat } from "./table-motion";

/** What the Room table reads from the connection to the room. A `RoomConnection` fits. */
export interface RoomTableSource {
  /** The room as last confirmed. */
  room: () => RoomView | null;
  playerId: () => string | null;
  watching: () => boolean;
  status: () => ReturnType<RoomConnection["status"]>;
  canAct: () => boolean;
  /** Changes when the room resyncs. */
  syncId: () => number;
}

/** The page the table plays on: where cards fly, and what the browser tab is doing. */
export interface RoomTablePage {
  motion: DealMotion;
  /** True while the browser tab is hidden. Reactive. */
  tabHidden: () => boolean;
  isVisibleNow: () => boolean;
  /** Calls `listener` whenever `motion.allowed()` may have changed. Returns an unsubscribe. */
  onMotionChange: (listener: () => void) => () => void;
  /** Runs right after each frame renders, before the deal measures where its cards fly. */
  rendered: (phase: RoomView["phase"] | null) => void;
  /** Draws the eye to the action bar and the viewer's seat. */
  nudge: () => void;
}

interface RoomTableOptions {
  code: string;
  source: RoomTableSource;
  page: RoomTablePage;
  sound: (cue: RoomCue) => void;
  haptic: (cue: RoomHapticCue) => void;
}

const createTabHidden = () => {
  const [hidden, setHidden] = createSignal(false);

  const sync = () => {
    setHidden(document.visibilityState === "hidden");
  };

  onSettled(() => {
    sync();
    document.addEventListener("visibilitychange", sync);

    return () => {
      document.removeEventListener("visibilitychange", sync);
    };
  });

  return hidden;
};

/** The Room table's page in the browser: the room page element and its tab. */
export const createRoomTablePage = (root: () => HTMLElement | undefined) =>
  ({
    isVisibleNow: () => document.visibilityState === "visible",
    motion: createDealMotion(root),
    nudge: () => {
      const page = root();
      nudge(page?.querySelector("[data-action-bar]") ?? null);
      revealOwnSeat(page);
    },
    onMotionChange: (listener) => {
      const motionPreference = globalThis.matchMedia?.(MOTION_PREFERENCE_QUERY);
      motionPreference?.addEventListener("change", listener);
      document.addEventListener("visibilitychange", listener);

      return () => {
        motionPreference?.removeEventListener("change", listener);
        document.removeEventListener("visibilitychange", listener);
      };
    },
    rendered: createTableOpening(root),
    tabHidden: createTabHidden(),
  }) satisfies RoomTablePage;

/**
 * The Room table: what this viewer's table shows right now, and the Move
 * alert that goes with it. It feeds each Room update the connection confirms
 * to Deal playback once the viewer is seated or watching, renders each frame
 * before the next card measures its flight, and catches playback up when the
 * tab hides or the viewer asks for less motion. The Move alert follows the
 * confirmed room and fires once playback shows the Move. Deal playback samples
 * visibility directly so a pending visibilitychange cannot misclassify an outcome.
 *
 * Returns the playback `view`, the `shown` room and seat (null while there's
 * no table to show), whether the Move alert is on, and the page title.
 */
export const createRoomTable = (options: RoomTableOptions) => {
  const { page, source } = options;
  const [view, setView] = createSignal(initialDealPlayback);
  let disposed = false;

  const playback = createDealPlayback(
    page.motion,
    (frame) => {
      setView(frame);
      flush();
      page.rendered(frame.room?.phase ?? null);
    },
    options.sound,
    options.haptic
  );

  const atTable = () => source.playerId() !== null || source.watching();

  createEffect(
    () => {
      const status = source.status();
      const room = source.room();

      return room && atTable() && status !== "missing" && status !== "removed"
        ? {
            canAct: source.canAct(),
            playerId: source.playerId(),
            room,
            syncId: source.syncId(),
          }
        : null;
    },
    (next) => {
      // WARNING: Publishing a frame flushes, which an effect can't do, so play the update after it.
      queueMicrotask(() => {
        if (!disposed) {
          playback.update(
            next && { ...next, hapticsVisible: page.isVisibleNow() }
          );
        }
      });
    }
  );

  const alert = createMoveAlert({
    play: {
      haptic: () => {
        options.haptic("turn");
      },
      nudge: page.nudge,
      sound: () => {
        options.sound("turn");
      },
    },
    playerId: source.playerId,
    room: source.room,
    syncId: source.syncId,
    tabHidden: page.tabHidden,
    title: () => {
      let prefix = source.watching() ? "Watching · " : "";

      if (alert.alerting()) {
        prefix = "Your move · ";
      }

      return `${prefix}Room ${options.code} · Flip 7`;
    },
    view,
  });

  const shown = createMemo(
    () => {
      const { room } = view();

      return room && atTable() ? { playerId: source.playerId(), room } : null;
    },
    {
      equals: (a, b) => a?.room === b?.room && a?.playerId === b?.playerId,
    }
  );

  onSettled(() => {
    const stopWatchingMotion = page.onMotionChange(playback.syncMotion);

    return () => {
      disposed = true;
      stopWatchingMotion();
      playback.dispose();
    };
  });

  return { alerting: alert.alerting, shown, title: alert.title, view };
};
