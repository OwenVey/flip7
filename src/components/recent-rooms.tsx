import ArrowRight from "@lucide/solid/icons/arrow-right";
import { useNavigate } from "@solidjs/router";
import { Button } from "@ui-sdk/solid/button";
import { createSignal, For, onSettled, Show } from "solid-js";

import { forgetRoom, readRecentRooms } from "../lib/recent-rooms";
import type { RecentRoom } from "../lib/recent-rooms";
import { roomExists } from "../lib/room-functions";
import { paths } from "../router";

const SHOWN_ROOMS = 3;

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
] as const;

const joinedAgo = (joinedAt: number, now: number) => {
  const elapsed = Math.max(0, now - joinedAt);

  if (elapsed < UNITS[2][1]) {
    return "just now";
  }

  const [unit, size] = UNITS.find(([, ms]) => elapsed >= ms) ?? UNITS[2];

  return relativeTime.format(-Math.floor(elapsed / size), unit);
};

const usableLocalStorage = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

const rejoinableRooms = async (storage: Storage) => {
  const saved = readRecentRooms(storage).slice(0, SHOWN_ROOMS);

  const checked = await Promise.all(
    saved.map(async (room) => ({
      exists: await roomExists(room.code).catch(() => null),
      room,
    }))
  );

  const rooms: RecentRoom[] = [];

  for (const { exists, room } of checked) {
    if (exists === false) {
      forgetRoom(storage, room.code);
    } else {
      rooms.push(room);
    }
  }

  return rooms;
};

const createRecentRooms = () => {
  const [rooms, setRooms] = createSignal<RecentRoom[]>([]);

  // WARNING: storage exists only in the browser, so read it after hydration to match the server markup.
  onSettled(() => {
    let disposed = false;

    const load = async () => {
      const storage = usableLocalStorage();

      if (storage === null) {
        return;
      }

      const found = await rejoinableRooms(storage);

      if (!disposed) {
        setRooms(found);
      }
    };

    void load();

    return () => {
      disposed = true;
    };
  });

  return rooms;
};

/** Rooms this browser can rejoin, listed under Play once the server confirms they still exist. */
export default function RecentRooms() {
  const rooms = createRecentRooms();
  const navigate = useNavigate();
  const now = Date.now();

  return (
    <Show when={rooms().length > 0}>
      <p class="home-divider" aria-hidden="true">
        or jump back in
      </p>
      <section class="home-recent" aria-label="Your recent rooms">
        <ul class="home-recent-list">
          <For each={rooms()}>
            {(room) => (
              <li>
                <span class="home-recent-code">{room.code}</span>
                <span class="home-recent-time">
                  {room.joinedAt === null ? "" : joinedAgo(room.joinedAt, now)}
                </span>
                <Button
                  data-size="sm"
                  onClick={() => {
                    navigate(paths.room(room.code));
                  }}
                >
                  Rejoin <span class="sr-only">room {room.code}</span>
                  <ArrowRight size={14} />
                </Button>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
