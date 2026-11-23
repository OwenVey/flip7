import BotPlus from "@lucide/solid/icons/bot-plus";
import Play from "@lucide/solid/icons/play";
import UserPlus from "@lucide/solid/icons/user-plus";
import { Button } from "@ui-sdk/solid/button";
import { createMemo, For, Repeat, Show } from "solid-js";

import { MAX_PLAYERS } from "../game/engine";
import { availableMoves, MIN_PLAYERS } from "../game/moves";
import type { RoomView } from "../game/protocol";
import { createCopy, createInvite } from "../lib/invite";
import type { RoomConnection } from "../lib/room-connection";
import InviteButton from "./invite-button";
import LeaveRoom from "./leave-room";
import OfflineBadge from "./offline-badge";
import PlayerAvatar from "./player-avatar";
import RemovePlayer from "./remove-player";

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

  const count = () => `${props.room.players.length} / ${MAX_PLAYERS}`;

  const hostName = () =>
    props.room.players.find((player) => player.id === props.room.hostId)
      ?.name ?? "the host";

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
        <section class="panel invite">
          <h2>Invite friends</h2>
          <RoomCode code={props.room.code} />
          <p class="muted">
            Send the link, or have them enter the code on the home page. No
            accounts needed.
          </p>
          <InviteButton solid />
        </section>

        <section class="panel players">
          <div class="panel-title">
            <h2>Players</h2>
            <Show when={!isHost()}>
              <span class="badge" data-tone="muted">
                {count()}
              </span>
            </Show>
          </div>
          <Show when={isHost()}>
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
                <span class="badge" data-tone="muted">
                  <span class="sr-only">Players: </span>
                  {count()}
                </span>
              </Button>
            </div>
          </Show>
          <ul class="roster">
            <For each={props.room.players} keyed={(player) => player.id}>
              {(player) => (
                <li data-offline={player().connected ? undefined : ""}>
                  <PlayerAvatar player={player()} />
                  <span class="roster-name">
                    {player().name}
                    {player().id === props.playerId ? " (you)" : ""}
                  </span>
                  <Show when={player().id === props.room.hostId}>
                    <span class="badge">Host</span>
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
            <Repeat count={openSeats()}>{() => <OpenSeat />}</Repeat>
          </ul>
          <Show
            when={isHost()}
            fallback={
              <p class="lobby-status">
                Waiting for {hostName()} to start the game.
              </p>
            }
          >
            <Show
              when={moves().host.start}
              fallback={
                <p class="lobby-status">
                  Waiting for {missing()} more{" "}
                  {missing() === 1 ? "player" : "players"} to join, or add a
                  bot.
                </p>
              }
            >
              <div class="start-game">
                <Button
                  disabled={props.actionsDisabled}
                  data-variant="solid"
                  onClick={async () => await props.send({ type: "start" })}
                >
                  <Play size={16} />
                  Start game
                </Button>
              </div>
            </Show>
          </Show>
        </section>
      </div>
    </div>
  );
}
