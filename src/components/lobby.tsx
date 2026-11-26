import BotPlus from "@lucide/solid/icons/bot-plus";
import Crown from "@lucide/solid/icons/crown";
import Lock from "@lucide/solid/icons/lock";
import Play from "@lucide/solid/icons/play";
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
import { createCopy } from "../lib/invite";
import type { RoomChatLog } from "../lib/room-chat-log";
import type { RoomConnection } from "../lib/room-connection";
import { pop } from "../lib/table-motion";
import ChatSheet from "./chat-sheet";
import ChatLogPanel from "./game-log";
import InviteButton from "./invite-button";
import LeaveRoom from "./leave-room";
import OfflineBadge from "./offline-badge";
import PlayerMenu from "./player-menu";
import RoomSettingsForm, { settingsSummary } from "./room-settings";
import {
  SpectatorActions,
  WatchInstead,
  WatcherCount,
} from "./spectator-controls";
import type { Spectator } from "./spectator-controls";

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

const OpenSeat = (props: { next: boolean; locked: boolean }) => (
  <li
    class="open-seat"
    aria-hidden="true"
    data-locked={props.locked ? "" : undefined}
    data-next={props.next ? "" : undefined}
  >
    <Show
      when={props.locked}
      fallback={<Show when={props.next}>Waiting for players…</Show>}
    >
      <Lock size={16} />
    </Show>
  </li>
);

export default function Lobby(props: {
  room: RoomView;
  playerId: string | null;
  send: RoomConnection["send"];
  chatLog: RoomChatLog;
  actionsDisabled?: boolean;
  /** A Spectator's Join and Leave, shown where a player's Leave goes. */
  spectator?: Spectator;
  /** Gives up this player's seat and keeps watching on the same connection. */
  onWatchInstead?: () => void;
  watchInsteadPending?: boolean;
}) {
  const moves = createMemo(() => availableMoves(props.room, props.playerId));
  const isHost = () => moves().host.configure;

  const addBotBlocked = () =>
    props.actionsDisabled === true || !moves().host.addBot;

  const missing = () => Math.max(0, MIN_PLAYERS - props.room.players.length);

  const openSeats = createMemo(() => MAX_PLAYERS - props.room.players.length);

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
        <h1>Lobby</h1>
        <div class="row">
          <WatcherCount
            count={props.room.spectatorCount}
            watching={props.playerId === null}
          />
          <ChatSheet chatLog={props.chatLog} />
          <Show
            when={props.playerId !== null}
            fallback={
              <Show when={props.spectator}>
                {(spectator) => (
                  <SpectatorActions
                    room={props.room}
                    join={spectator().join}
                    onStopWatching={spectator().onLeave}
                  />
                )}
              </Show>
            }
          >
            <Show when={props.onWatchInstead}>
              <WatchInstead
                room={props.room}
                playerId={props.playerId ?? ""}
                disabled={props.actionsDisabled}
                pending={props.watchInsteadPending}
                onWatch={() => props.onWatchInstead?.()}
              />
            </Show>
            <LeaveRoom
              disabled={props.actionsDisabled}
              onLeave={() => {
                void props.send({ type: "leave" });
              }}
            />
          </Show>
        </div>
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
                    data-game-tap=""
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
          <ul class="roster" aria-label="Players">
            <For each={props.room.players} keyed={(player) => player.id}>
              {(player) => (
                <li
                  data-arrived={rendered ? "" : undefined}
                  data-offline={player().connected ? undefined : ""}
                >
                  <PlayerMenu
                    player={player()}
                    host={moves().host}
                    disabled={props.actionsDisabled}
                    onRemove={(playerId) => {
                      void props.send({ playerId, type: "kick" });
                    }}
                    onMakeHost={(playerId) => {
                      void props.send({ playerId, type: "makeHost" });
                    }}
                  />
                  <span class="roster-name" dir="auto" title={player().name}>
                    {player().name}
                  </span>
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
                </li>
              )}
            </For>
            <Repeat count={openSeats()}>
              {(index) => (
                <OpenSeat
                  next={index === 0}
                  locked={props.room.settings.locked}
                />
              )}
            </Repeat>
          </ul>
        </section>

        <ChatLogPanel chatLog={props.chatLog} />
      </div>
    </div>
  );
}
