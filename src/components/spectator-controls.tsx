import Eye from "@lucide/solid/icons/eye";
import LogOut from "@lucide/solid/icons/log-out";
import UserPlus from "@lucide/solid/icons/user-plus";
import X from "@lucide/solid/icons/x";
import { Button } from "@ui-sdk/solid/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/solid/dialog";
import { Show } from "solid-js";

import { MAX_PLAYERS } from "../game/engine";
import { rejectWatchInstead } from "../game/moves";
import type { RoomView } from "../game/protocol";
import JoinForm from "./join-form";
import ScrollFade from "./scroll-fade";
import Tooltip from "./tooltip";

/** How many spectators are watching. Players only see it once someone is. */
export const WatcherCount = (props: { count: number; watching: boolean }) => (
  <Show when={props.watching || props.count > 0}>
    <span class="watcher-count">
      <Eye size={16} aria-hidden="true" />
      <span class="button-label">{props.count} watching</span>
      <span class="watcher-count-short" aria-hidden="true">
        {props.count}
      </span>
    </span>
  </Show>
);

/** A seated player's way to give up their seat and keep watching. */
export const WatchInstead = (props: {
  room: RoomView;
  playerId: string;
  disabled?: boolean;
  pending?: boolean;
  onWatch: () => void;
}) => {
  const blocked = () => rejectWatchInstead(props.room, props.playerId) ?? "";

  const unavailable = () =>
    blocked() !== "" || props.disabled === true || props.pending === true;

  return (
    <Tooltip
      content={blocked() || "Watch instead"}
      type={blocked() ? "description" : "label"}
      compactOnly={!blocked()}
      side="bottom"
      trigger={(hint) => (
        <Button
          {...hint}
          class="spectator-action"
          aria-label="Watch instead"
          aria-disabled={unavailable() ? "true" : undefined}
          onClick={() => {
            if (!unavailable()) {
              props.onWatch();
            }
          }}
        />
      )}
    >
      <Eye size={16} aria-hidden="true" />
      <span class="button-label" aria-hidden="true">
        {props.pending === true ? "Switching…" : "Watch instead"}
      </span>
    </Tooltip>
  );
};

/** What a spectator's join form needs from the room connection. */
export interface SpectatorJoin {
  savedName: string;
  savedAvatar: number | null;
  onJoin: (name: string, avatar: number) => void;
  error: string;
  joining: boolean;
  unavailable: boolean;
  onEdit: () => void;
}

/** A spectator's header actions: take a seat in a dialog, or leave back to the room's join screen. */
export const SpectatorActions = (props: {
  room: RoomView;
  join: SpectatorJoin;
  onStopWatching: () => void;
}) => {
  const blocked = () => {
    if (props.room.players.length >= MAX_PLAYERS) {
      return `The table is full (${MAX_PLAYERS} players)`;
    }

    return props.room.settings.locked && props.room.players.length > 0
      ? "The host has locked the room"
      : "";
  };

  return (
    <>
      <Dialog
        onOpenChange={(open) => {
          if (open) {
            props.join.onEdit();
          }
        }}
      >
        <Tooltip
          content={blocked() || "Join as player"}
          type={blocked() ? "description" : "label"}
          compactOnly={!blocked()}
          side="bottom"
          trigger={(hint) => (
            <DialogTrigger
              {...hint}
              class="spectator-action"
              data-variant="solid"
              aria-label="Join as player"
              aria-disabled={blocked() ? "true" : undefined}
              onClick={(event) => {
                if (blocked()) {
                  event.preventDefault();
                }
              }}
            />
          )}
        >
          <UserPlus size={16} aria-hidden="true" />
          <span class="button-label" aria-hidden="true">
            Join
          </span>
        </Tooltip>
        <DialogContent class="join-dialog">
          <header class="table-sheet-header">
            <DialogTitle>Take a seat</DialogTitle>
            <Tooltip
              content="Close"
              type="label"
              trigger={(hint) => (
                <DialogClose
                  {...hint}
                  aria-label="Close"
                  data-size="sm"
                  data-icon=""
                />
              )}
            >
              <X size={16} aria-hidden="true" />
            </Tooltip>
          </header>
          <ScrollFade viewportClass="table-sheet-body" label="Take a seat">
            <JoinForm
              embedded
              room={props.room}
              locked={props.room.settings.locked}
              savedName={props.join.savedName}
              savedAvatar={props.join.savedAvatar}
              onJoin={props.join.onJoin}
              error={props.join.error}
              joining={props.join.joining}
              unavailable={props.join.unavailable}
              onEdit={props.join.onEdit}
            />
          </ScrollFade>
        </DialogContent>
      </Dialog>
      <Tooltip
        content="Leave room"
        type="label"
        compactOnly
        side="bottom"
        trigger={(hint) => (
          <Button
            {...hint}
            class="spectator-action"
            data-tone="danger"
            aria-label="Leave room"
            aria-disabled={props.join.joining ? "true" : undefined}
            onClick={() => {
              if (!props.join.joining) {
                props.onStopWatching();
              }
            }}
          />
        )}
      >
        <LogOut size={16} aria-hidden="true" />
        <span class="button-label" aria-hidden="true">
          Leave
        </span>
      </Tooltip>
    </>
  );
};
