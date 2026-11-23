import BotPlus from "@lucide/solid/icons/bot-plus";
import Crown from "@lucide/solid/icons/crown";
import Lock from "@lucide/solid/icons/lock";
import Play from "@lucide/solid/icons/play";
import UserPlus from "@lucide/solid/icons/user-plus";
import { Button } from "@ui-sdk/solid/button";
import {
  createEffect,
  createMemo,
  createUniqueId,
  For,
  onSettled,
  Repeat,
  Show,
} from "solid-js";

import { MAX_PLAYERS } from "../game/engine";
import { availableMoves, MIN_PLAYERS } from "../game/moves";
import type { RoomView } from "../game/protocol";
import { hostName } from "../lib/host";
import { createCopy, createInvite } from "../lib/invite";
import type { RoomConnection } from "../lib/room-connection";
import { pop } from "../lib/table-motion";
import InviteButton from "./invite-button";
import LeaveRoom from "./leave-room";
import OfflineBadge from "./offline-badge";
import PlayerAvatar from "./player-avatar";
import RemovePlayer from "./remove-player";
import RoomSettingsForm, { settingsSummary } from "./room-settings";

const RoomCode = (props: { code: string }) => {
  const { copied, copy } = createCopy();

  return (
    <div class="room-code-copy">
      <button
        type="button"
        class="room-code"
        aria-label={`Room code ${props.code}. Copy`}
        onClick={() => {
          void copy(props.code);
        }}
      >
        {props.code}
      </button>
      <output class="badge room-code-status">{copied() ? "Copied" : ""}</output>
    </div>
  );
};

const OpenSeat = () => {
  const { copied, invite, shares } = createInvite();

  const action = () => {
    if (copied()) {
      return "Link copied";
    }

    return shares() ? "Invite a friend" : "Copy invite link";
  };

  return (
    <li class="open-seat">
      <button
        type="button"
        onClick={() => {
          void invite();
        }}
      >
        <UserPlus size={16} aria-hidden="true" />
        <span>Open seat</span>
        <span class="open-seat-action">{action()}</span>
      </button>
    </li>
  );
};

const LockedSeat = () => (
  <li class="open-seat" data-locked="">
    <span>
      <Lock size={16} aria-hidden="true" />
      <span>Room locked</span>
    </span>
  </li>
);

export default function Lobby(props: {
  room: RoomView;
  playerId: string;
  send: RoomConnection["send"];
  actionsDisabled?: boolean;
}) {
  const moves = createMemo(() => availableMoves(props.room, props.playerId));
  const isHost = () => props.room.hostId === props.playerId;

  const addBotBlocked = () =>
    props.actionsDisabled === true || !moves().host.addBot;

  const missing = () => Math.max(0, MIN_PLAYERS - props.room.players.length);

  const openSeats = createMemo(() =>
    props.room.players.length < MAX_PLAYERS ? 1 : 0
  );

  const startHintId = createUniqueId();

  // WARNING: CSS can't tell a join from a page load, so only rows added after the first render animate.
  let rendered = false;
  let startGame: HTMLDivElement | undefined;

  onSettled(() => {
    rendered = true;
  });

  createEffect(
    () => moves().host.start,
    (ready, wasReady) => {
      if (ready && wasReady === false) {
        pop(startGame, 1.08);
      }
    }
  );

  const count = () => `${props.room.players.length} / ${MAX_PLAYERS}`;

  return (
    <div class="lobby-page">
      <header class="page-header">
        <h1>Get your table together</h1>
        <LeaveRoom
          disabled={props.actionsDisabled}
          onLeave={() => {
            void props.send({ type: "leave" });
          }}
        />
      </header>

      <div class="lobby">
        <div class="lobby-side">
          <section class="panel invite">
            <h2>Invite friends</h2>
            <RoomCode code={props.room.code} />
            <p class="muted">
              Send the link, or have them enter the code on the home page. No
              accounts needed.
            </p>
            <InviteButton solid />
          </section>

          <Show
            when={isHost()}
            fallback={
              <div class="lobby-status">
                <p>Waiting for {hostName(props.room)} to start the game.</p>
                <p class="lobby-settings">{settingsSummary(props.room)}</p>
              </div>
            }
          >
            <section class="panel host-controls">
              <h2>Host controls</h2>
              <RoomSettingsForm
                room={props.room}
                readOnly={
                  props.actionsDisabled === true || !moves().host.configure
                }
                onChange={(changes) => {
                  void props.send({ ...changes, type: "configure" });
                }}
              />
              <div class="host-actions">
                <div class="add-bot">
                  <Button
                    aria-disabled={addBotBlocked() ? "true" : undefined}
                    onClick={async () => {
                      if (!addBotBlocked()) {
                        await props.send({ type: "addBot" });
                      }
                    }}
                  >
                    <BotPlus size={16} aria-hidden="true" />
                    {moves().host.addBot ? "Add bot" : "Table full"}
                  </Button>
                </div>
                <div
                  class="start-game"
                  ref={(element) => {
                    startGame = element;
                  }}
                >
                  <Button
                    disabled={props.actionsDisabled}
                    aria-disabled={moves().host.start ? undefined : "true"}
                    aria-describedby={
                      moves().host.start ? undefined : startHintId
                    }
                    data-variant="solid"
                    onClick={async () => {
                      if (moves().host.start) {
                        await props.send({ type: "start" });
                      }
                    }}
                  >
                    <Play size={16} aria-hidden="true" />
                    Start game
                  </Button>
                  <Show when={!moves().host.start}>
                    <p id={startHintId} class="start-hint">
                      Add a bot or invite {missing()} more{" "}
                      {missing() === 1 ? "player" : "players"}.
                    </p>
                  </Show>
                </div>
              </div>
            </section>
          </Show>
        </div>

        <section class="panel players">
          <div class="panel-title">
            <h2>Players</h2>
            <span class="badge" data-tone="muted">
              {count()}
            </span>
          </div>
          <ul class="roster">
            <For each={props.room.players} keyed={(player) => player.id}>
              {(player) => (
                <li
                  data-arrived={rendered ? "" : undefined}
                  data-offline={player().connected ? undefined : ""}
                >
                  <PlayerAvatar player={player()} />
                  <span class="roster-name">{player().name}</span>
                  <Show when={player().id === props.playerId}>
                    <span class="badge">You</span>
                  </Show>
                  <Show when={player().bot}>
                    <span class="badge" data-tone="bot">
                      Bot
                    </span>
                  </Show>
                  <Show when={player().id === props.room.hostId}>
                    <span class="badge" data-tone="host">
                      <Crown size={12} aria-hidden="true" />
                      Host
                    </span>
                  </Show>
                  <Show when={!player().connected}>
                    <OfflineBadge />
                  </Show>
                  <Show when={moves().host.kick.includes(player().id)}>
                    <RemovePlayer
                      bot={player().bot}
                      confirm={player().bot !== true}
                      disabled={props.actionsDisabled}
                      name={player().name}
                      onRemove={() => {
                        void props.send({
                          playerId: player().id,
                          type: "kick",
                        });
                      }}
                    />
                  </Show>
                </li>
              )}
            </For>
            <Repeat count={openSeats()}>
              {() => (
                <Show when={props.room.locked} fallback={<OpenSeat />}>
                  <LockedSeat />
                </Show>
              )}
            </Repeat>
          </ul>
        </section>
      </div>
    </div>
  );
}
