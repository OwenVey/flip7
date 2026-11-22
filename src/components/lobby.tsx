import BotPlus from "@lucide/solid/icons/bot-plus";
import Play from "@lucide/solid/icons/play";
import { Button } from "@ui-sdk/solid/button";
import { createMemo, For, Repeat, Show } from "solid-js";

import { MAX_PLAYERS } from "../game/engine";
import { availableMoves, MIN_PLAYERS } from "../game/moves";
import type { RoomView } from "../game/protocol";
import type { RoomConnection } from "../lib/room-connection";
import InviteButton from "./invite-button";
import LeaveRoom from "./leave-room";
import PlayerAvatar from "./player-avatar";
import RemovePlayer from "./remove-player";

const OPEN_SEATS_SHOWN = 2;

export default function Lobby(props: {
  room: RoomView;
  playerId: string;
  send: RoomConnection["send"];
  actionsDisabled?: boolean;
}) {
  const moves = createMemo(() => availableMoves(props.room, props.playerId));
  const isHost = () => props.room.hostId === props.playerId;

  const missing = () => Math.max(0, MIN_PLAYERS - props.room.players.length);

  const openSeats = createMemo(() =>
    Math.min(
      Math.max(missing(), OPEN_SEATS_SHOWN - props.room.players.length, 1),
      MAX_PLAYERS - props.room.players.length
    )
  );

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
          <p class="room-code" aria-label={`Room code ${props.room.code}`}>
            {props.room.code}
          </p>
          <p class="muted">
            Send the link, or have them enter the code on the home page. No
            accounts needed.
          </p>
          <InviteButton solid />
        </section>

        <section class="panel">
          <div class="panel-title">
            <h2>Players</h2>
            <span class="badge" data-tone="muted">
              {props.room.players.length} / {MAX_PLAYERS}
            </span>
          </div>
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
                    <span class="badge" data-tone="muted">
                      Offline
                    </span>
                  </Show>
                  <Show when={moves().host.kick.includes(player().id)}>
                    <RemovePlayer
                      bot={player().bot}
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
                <li class="open-seat" aria-hidden="true">
                  Open seat
                </li>
              )}
            </Repeat>
          </ul>
          <Show when={moves().host.addBot}>
            <div class="add-bot">
              <Button
                disabled={props.actionsDisabled}
                onClick={async () => await props.send({ type: "addBot" })}
              >
                <BotPlus size={16} aria-hidden="true" />
                Add bot
              </Button>
            </div>
          </Show>
          <Show
            when={isHost()}
            fallback={
              <p class="muted">Waiting for {hostName()} to start the game.</p>
            }
          >
            <Show
              when={moves().host.start}
              fallback={
                <p class="muted">
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
